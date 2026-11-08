// For a-few-of-every-sweep-*.test.ts. The writers in `fuzz/fuzzilli` each write out a cross of small programs, some thousands to some hundred thousands. Here each of them writes out a dozen, spread over its
// cross, when a test file loads. Each program is built alone, into an executable of its own: does the build end with an executable, and does that print what `bun <file>` prints and end as it ends?
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "../supported";
import { run } from "./run";

const writers = join(import.meta.dir, "..", "fuzz", "fuzzilli");

// These have test files of their own, or take other arguments, or make their programs out of the stored ones, which come and go.
const asidesFromThese = new Set([
  "write-everyday-gathering-sweep.ts",
  "write-everyday-program-sweep.ts",
  "write-member-sweep.ts",
  "write-near-helper-sweep.ts",
  "write-package-sweep.ts",
  "write-turn-sweep.ts",
]);

// TypeScript refuses these too, so the build has to.
const refused = new Set([
  "24062-an-exported-let-with-a-setter--another-file-imports-by-name--plus-true--no-helper--slice.ts",
  "37049-an-exported-constant--another-file-imports-it-at-run-time--plus-true--an-arrow--at.ts",
]);

// A program is one text. A first line `// @entry: ./main.ts` names the file that it is laid out as, and `// @filename: ./other.mjs` begins another file.
function laidOut(name: string, text: string) {
  const lines = text.split("\n");
  const named = /^\/\/ @entry: \.\/(.+)$/.exec(lines[0]);
  const entry = named ? named[1] : "p" + name.slice(name.lastIndexOf("."));
  const files: Record<string, string[]> = { [entry]: [] };
  let into = files[entry];
  for (const line of named ? lines.slice(1) : lines) {
    const next = /^\/\/ @filename: \.\/(\S+)/.exec(line);
    if (next) into = files[next[1]] ??= [];
    else into.push(line);
  }
  return { entry, files: Object.fromEntries(Object.entries(files).map(([file, all]) => [file, all.join("\n")])) };
}

export function aFewOfEverySweepIn(part: number, parts: number) {
  const mine = readdirSync(writers)
    .filter(name => /^write-.*-sweep\.ts$/.test(name) && !asidesFromThese.has(name))
    .sort()
    .filter((_, at) => at % parts === part - 1);
  for (const writer of mine) {
    using dir = tempDir("aot-a-few-of-every-sweep", {});
    // The stride has no factor in common with the length of any cross.
    const { exitCode, stderr } = Bun.spawnSync({
      cmd: [bunExe(), join(writers, writer), String(dir), "1", "12", "10007"],
      env: bunEnv,
      stderr: "pipe",
    });
    if (exitCode !== 0) throw new Error(`${writer} ended with ${exitCode}: ${stderr}`);
    for (const name of readdirSync(String(dir)).sort()) {
      const { entry, files } = laidOut(name, readFileSync(join(String(dir), name), "utf8"));
      test(`${writer.slice("write-".length, -"-sweep.ts".length)}: ${name}`, async () => {
        using home = tempDir("aot-one-of-a-sweep", files);
        const folder = String(home);
        const executable = join(folder, "program" + (isWindows ? ".exe" : ""));
        const [plain, build] = await Promise.all([
          run([bunExe(), "./" + entry], folder, bunEnv),
          run([bunExe(), "build", "--compile", "--aot", "./" + entry, "--outfile", executable], folder, bunEnv),
        ]);
        // A program that said nothing and ended well would be the same as any other that did.
        expect(plain.stdout !== "" || plain.exitCode !== 0).toBe(true);
        if (refused.has(name)) {
          expect({ exitCode: build.exitCode, byTypeScript: /\bTS\d+\b/.test(build.stderr) }).toEqual({
            exitCode: 1,
            byTypeScript: true,
          });
          return;
        }
        expect({ stderr: build.exitCode ? build.stderr : "", exitCode: build.exitCode }).toEqual({
          stderr: "",
          exitCode: 0,
        });
        const compiled = await run([executable], folder, bunEnv);
        expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({
          stdout: plain.stdout,
          exitCode: plain.exitCode,
        });
      });
    }
  }
}
