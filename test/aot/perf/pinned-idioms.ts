// What ./idioms.test.ts runs. It says how.
import { afterAll, expect } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isASAN, isCI, isDebug, isMusl, isWindows, tempDir } from "harness";
import { join } from "path";
import { measureCommand } from "../analysis-scaling/measure-check";
import { withSteadyCollections } from "../harness/counted-run";
import { isToldWhatToTake } from "../harness/shares";
import { slot, spawned, withoutDebugInformation } from "../harness/commands";
import { describe, test } from "../supported";
import { writeUntypedIdioms } from "./untyped-idioms";

const root = join(import.meta.dir, "idioms");
const pinsPath = join(import.meta.dir, `pins.${process.platform}-${process.arch}.json`);
const mode = process.env.AOT_PERF;

type Forms = {
  typed: number;
  untyped: number;
  jit?: number;
  /** The least that was ever pinned, where today's pin is more. */
  best?: { typed: number; untyped: number };
};
const hasPins = existsSync(pinsPath);
const pins: Record<string, Forms> = hasPins ? JSON.parse(readFileSync(pinsPath, "utf8")) : {};
const turns: Record<string, number> = JSON.parse(readFileSync(join(import.meta.dir, "turns.json"), "utf8"));

const allIdioms = readdirSync(root, { recursive: true })
  .map(String)
  .filter(path => path.endsWith(".ts") && path !== "host.ts")
  .map(path => path.slice(0, -3).replaceAll("\\", "/"))
  .filter(name => new RegExp(process.env.AOT_PERF_ONLY ?? "").test(name))
  .sort();

const forms = ["typed", "untyped"] as const;
const isWorse = (now: number, pin: number) =>
  (now > pin * 1.1 && now > pin + 20) || (now > pin * 1.25 && now > pin + 4);
// The count of one executable moves by a sixth from run to run: these are held within 15%.
const wavering = ["built-in/stringify-a-message-of-code-with-one-wide-character"];

function withBest(now: Forms, before: Forms | undefined): Forms {
  const best = {
    typed: Math.min(now.typed, before?.best?.typed ?? before?.typed ?? Infinity),
    untyped: Math.min(now.untyped, before?.best?.untyped ?? before?.untyped ?? Infinity),
  };
  return {
    typed: now.typed,
    untyped: now.untyped,
    jit: now.jit,
    best: best.typed < now.typed || best.untyped < now.untyped ? best : undefined,
  };
}

const skipped =
  isDebug || isASAN
    ? "a debug or ASAN build counts other instructions"
    : isWindows
      ? "it counts with perf_event_open or /usr/bin/time -l"
      : isMusl
        ? "the pins are those of glibc"
        : undefined;
if (skipped) console.error(`SKIPPED: test/aot/perf/idioms.test.ts: ${skipped}`);

/** Whether CI runs them in parts, each a test file of its own (../parts.mts): on its slowest machines all of them take eight minutes. */
export const comesInParts = isCI && !mode && !process.env.AOT_PERF_ONLY;

export function pinnedIdiomsInParts(part: number, parts: number) {
  if (!comesInParts) return void test.skip("test/aot/perf/idioms.test.ts measures them in one go", () => {});
  pinnedIdioms(part, parts);
}

/** Every `parts`-th idiom from the `part`-th. */
export function pinnedIdioms(part = 1, parts = 1) {
  const idioms = allIdioms.filter((_, index) => index % parts === part - 1);
  describe.skipIf(!!skipped)("compile/aot/perf/idioms", () => {
    const folder = String(tempDir("aot-perf", {}));
    const carrier = skipped ? [] : withoutDebugInformation();
    const untypedRoot = join(folder, "idioms");
    if (!skipped) writeUntypedIdioms(untypedRoot);
    // Without pins only what the three forms print is compared. There a run that is told nothing starts no idiom after 200 seconds and says so.
    const mayLeaveOut = !hasPins && !mode && !process.env.AOT_PERF_ONLY && !isToldWhatToTake;
    let leftOut = 0;
    afterAll(() => {
      rmSync(folder, { recursive: true, force: true });
      if (leftOut)
        console.error(
          `SHARE: ${leftOut} of the ${idioms.length} idioms were not run: the file had run for 200 seconds`,
        );
      if (mode === "update" || mode === "lower") writeFileSync(pinsPath, JSON.stringify(pins, null, 2) + "\n");
    });

    async function instructions(cmd: string[], n: number) {
      // With concurrent compilation, how much the JIT's threads get done during a short and a long run is a matter of chance.
      const run = await measureCommand(root, cmd, 300_000, {
        ...bunEnv,
        ...withSteadyCollections,
        AOT_PERF_TURNS: String(n),
        BUN_JSC_useConcurrentJIT: "0",
      });
      return { count: run.instructions, printed: run.stdout };
    }
    async function aTurn(cmd: string[], n: number) {
      const short = await instructions(cmd, n >> 2);
      const long = await instructions(cmd, n);
      return {
        instructions:
          short.count === undefined || long.count === undefined
            ? undefined
            : Math.round(((long.count - short.count) / (n - (n >> 2))) * 10) / 10,
        printed: long.printed,
      };
    }
    async function compiled(root: string, source: string, n: number) {
      const executable = join(folder, source.replaceAll(/[^a-z0-9]+/gi, "-"));
      const build = await spawned(
        [bunExe(), "build", "--compile", "--aot", ...carrier, join(root, source), "--outfile", executable],
        root,
        bunEnv,
      );
      expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({
        stderr: expect.not.stringMatching(/^error\b/m),
        exitCode: 0,
      });
      try {
        return await aTurn([executable], n);
      } finally {
        rmSync(executable, { force: true });
      }
    }

    // Ahead of the others: a test that is not concurrent between two that are makes the second wait for the first.
    for (const name of idioms) {
      for (const form of forms) {
        const { best, [form]: pin } = pins[name] ?? {};
        if (best && pin !== undefined && isWorse(pin, best[form]))
          test.todo(`${name}, ${form}: ${pin} instructions an iteration; it was ${best[form]}`);
      }
    }
    for (const name of idioms.filter(name => wavering.includes(name)))
      test.todo(`${name}: takes as many instructions an iteration in every run`);
    for (const name of idioms) {
      test.concurrent(
        name,
        () =>
          slot(async () => {
            if (mayLeaveOut && performance.now() > 200_000) return void leftOut++;
            const n = turns[name];
            const typed = await compiled(root, name + ".ts", n);
            const untyped = await compiled(untypedRoot, name + ".js", n);
            const plain =
              mode === "update"
                ? await aTurn([bunExe(), "run", join(untypedRoot, name + ".js")], n)
                : await instructions([bunExe(), "run", join(untypedRoot, name + ".js")], n);
            // All three forms did the same work.
            expect([typed.printed, untyped.printed]).toEqual([plain.printed, plain.printed]);
            if (typed.instructions === undefined || untyped.instructions === undefined)
              return void console.error(`SKIPPED: ${name}: instructions cannot be counted here`);
            const now: Forms = { typed: typed.instructions, untyped: untyped.instructions };
            const pin = pins[name];
            console.error(`IDIOM ${name}\t${now.typed}\t${now.untyped}\t| the pin\t${pin?.typed}\t${pin?.untyped}`);
            if (mode === "update")
              return void (pins[name] = withBest(
                { ...now, jit: "instructions" in plain ? plain.instructions : undefined },
                pin,
              ));
            if (!hasPins) return;
            expect(pin).toBeDefined();
            if (mode === "lower")
              pins[name] = withBest(
                { ...pin, typed: Math.min(pin.typed, now.typed), untyped: Math.min(pin.untyped, now.untyped) },
                pin,
              );
            const worse = forms.filter(form =>
              wavering.includes(name) ? now[form] > pin[form] * 1.15 : isWorse(now[form], pin[form]),
            );
            expect({ worse, now, pin: { typed: pin.typed, untyped: pin.untyped } }).toEqual({
              worse: [],
              now,
              pin: { typed: pin.typed, untyped: pin.untyped },
            });
          }),
        900_000,
      );
    }
  });
}
