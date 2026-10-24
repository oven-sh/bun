// `bun run --aot` runs on the JIT. A program under ./programs runs its code a few times, so with default thresholds the DFG and
// the FTL never compile it. Here each program runs twice under `bun run --aot`, with default thresholds and with eager tier-up,
// and both runs must print the same and end the same way.
// By default this takes the same tenth of all programs as the variant-* tests. AOT_PROGRAMS=<text> selects the programs whose
// path contains the text; AOT_PROGRAMS=/ selects all of them.
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "fs";
import { bunEnv, bunExe, isASAN } from "harness";
import { join } from "path";
import { inPrograms, inShare, inTenthOfAll, inThirdOfAll, listWrittenPrograms, mayHoldWhatIsWanted, slot, spawned, taken, told, unsupported, wanted } from "./run-programs";

const root = join(import.meta.dir, "programs");

const eagerTierUp = {
  BUN_JSC_useConcurrentJIT: "0",
  BUN_JSC_thresholdForJITAfterWarmUp: "10",
  BUN_JSC_thresholdForJITSoon: "10",
  BUN_JSC_thresholdForOptimizeAfterWarmUp: "20",
  BUN_JSC_thresholdForOptimizeSoon: "20",
  BUN_JSC_thresholdForFTLOptimizeAfterWarmUp: "60",
  BUN_JSC_thresholdForFTLOptimizeSoon: "60",
};

function findPrograms(folder: string, into: string[]) {
  const entries = readdirSync(folder, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
  const main = entries.find(entry => entry.isFile() && /^main\.(ts|tsx|js)$/.test(entry.name));
  if (main) return void into.push(join(folder, main.name));
  for (const entry of entries) {
    if (entry.isDirectory()) findPrograms(join(folder, entry.name), into);
    else if (/\.(ts|tsx|js)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) into.push(join(folder, entry.name));
  }
}

const hash = (path: string) => BigInt(Bun.hash(inPrograms(path).replaceAll("\\", "/")));
const withoutExtension = (path: string) => path.replace(/[\\/]main\.[a-z]+$/, "").replace(/\.[a-z]+$/, "");

const knownDifferences = new Set(
  readFileSync(join(import.meta.dir, "jit-mode-eager-tier-up-known.txt"), "utf8")
    .split("\n")
    .filter(line => line !== "" && !line.startsWith("#"))
    .map(line => line.split(/\s/)[0]),
);

export function eagerTierUpSweep(part: number, parts: number) {
  const all: string[] = [];
  findPrograms(root, all);
  const chosen = taken(
    [...all, ...listWrittenPrograms(/\.(ts|tsx|js)$/)]
      .filter(path => /[\\/]/.test(inPrograms(path)))
      .filter(mayHoldWhatIsWanted)
      .filter(path => inShare("eager tier-up " + inPrograms(path), 10, true))
      .filter(path => Number((hash(path) >> 16n) % BigInt(parts)) === part - 1)
      .filter(path => !isASAN || inThirdOfAll("eager tier-up", path)),
    path => (wanted === "" || wanted === "quick" ? inTenthOfAll("eager tier-up", path) : inPrograms(path).includes(wanted)),
  ).filter(path => !existsSync(withoutExtension(path) + ".build-errors.txt") && !existsSync(withoutExtension(path) + ".todo.txt"));

  describe.concurrent("run --aot with eager tier-up", () => {
    if (unsupported) return void test.skip(unsupported, () => {});
    if (chosen.length === 0) test.skip("no program selected", () => {});
    for (const path of chosen) {
      const name = inPrograms(withoutExtension(path)).replaceAll("\\", "/");
      if (knownDifferences.has(name)) {
        test.todo(name);
        continue;
      }
      test(
        name,
        () =>
          slot(async () => {
            const options: { env?: Record<string, string> } = existsSync(withoutExtension(path) + ".json") ? JSON.parse(readFileSync(withoutExtension(path) + ".json", "utf8")) : {};
            const env = { ...bunEnv, ...options.env, BUN_JSC_crashIfInterpreterIsUsed: undefined };
            const cmd = [bunExe(), "run", "--aot", path];
            const byDefault = await spawned(cmd, join(path, ".."), env);
            const eager = await spawned(cmd, join(path, ".."), { ...env, ...eagerTierUp });
            expect(byDefault.signal).toBeNull();
            expect({ signal: eager.signal, ...told(eager) }).toEqual({ signal: byDefault.signal, ...told(byDefault) });
          }),
        600_000,
      );
    }
  });
}
