// For a-few-of-every-sweep-*.test.ts. The writers in `fuzz/fuzzilli` each write out a cross of small programs, some thousands to some hundred thousands. Here each of them writes out a dozen, spread over its
// cross, when a test file loads. Each program is built alone, into an executable of its own: does the build end with an executable, and does that print what `bun <file>` prints and end as it ends?
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "../supported";
import { built, told } from "./commands";
import { run } from "./run";

// With it the build stops where a stage hands on what the next one does not take. Without it only some builds of Bun look.
const checked = "--aot-check=VerifyEachStage";

const writers = join(import.meta.dir, "..", "fuzz", "fuzzilli");

// These have test files of their own, or take other arguments, or make their programs out of the stored ones, which come and go. And in the two on graphs of modules loads are in flight at once: in which order
// `bun <file>` then runs the files is a matter of time, and on a busy machine it gives two answers.
const asidesFromThese = new Set([
  "write-everyday-awaiting-sweep.ts",
  "write-everyday-gathering-sweep.ts",
  "write-everyday-program-sweep.ts",
  "write-half-run-sweep.ts",
  "write-member-sweep.ts",
  "write-mixed-graph-sweep.ts",
  "write-near-helper-sweep.ts",
  "write-package-sweep.ts",
  "write-turn-sweep.ts",
]);

// TypeScript refuses these too, so the build has to. Both add `true` to a number.
const refused = new Set([
  "24062-an-exported-let-with-a-setter--another-file-imports-by-name--plus-true--no-helper--slice.ts",
  "37049-an-exported-constant--another-file-imports-it-at-run-time--plus-true--an-arrow--at.ts",
]);
const refusal = "error: TS2365: Operator '+' cannot be applied to types 'number' and 'boolean'.";

// One for each set of flags, and every program of a short sweep. The stride has no factor in common with 75 or 158.
const more = new Map([
  ["write-build-flag-sweep.ts", 75],
  ["write-package-namespace-sweep.ts", 158],
]);

// A program is one text. A first line `// @entry: ./main.ts` names the file that it is laid out as, and `// @filename: ./other.mjs` begins another file. A first line `// Flags: --minify` names flags that its
// build takes.
function laidOut(name: string, text: string) {
  const lines = text.split("\n");
  const flags = /^\/\/ Flags: (.+)$/.exec(lines[0])?.[1].split(" ") ?? [];
  const named = /^\/\/ @entry: \.\/(.+)$/.exec(lines[0]);
  const entry = named ? named[1] : "p" + name.slice(name.lastIndexOf("."));
  const files: Record<string, string[]> = { [entry]: [] };
  let into = files[entry];
  for (const line of named ? lines.slice(1) : lines) {
    const next = /^\/\/ @filename: \.\/(\S+)/.exec(line);
    if (next) into = files[next[1]] ??= [];
    else into.push(line);
  }
  return {
    name,
    entry,
    flags,
    files: Object.fromEntries(Object.entries(files).map(([file, all]) => [file, all.join("\n")])),
  };
}

/** The programs that a writer writes here, each laid out. */
async function programsOf(writer: string) {
  using dir = tempDir("aot-a-few-of-every-sweep", {});
  const count = more.get(writer) ?? 12;
  // The stride has no factor in common with the length of any cross.
  const command = [bunExe(), join(writers, writer), String(dir), "1", String(count), "10007"];
  const { exitCode, stderr } = await run(command);
  const names = readdirSync(String(dir)).sort();
  // Nothing else would miss the programs that a writer left out.
  if (exitCode !== 0 || names.length !== count)
    throw new Error(`${writer} ended with ${exitCode} and wrote ${names.length} programs of ${count}: ${stderr}`);
  return names.map(name => laidOut(name, readFileSync(join(String(dir), name), "utf8")));
}

/**
 * What the two runs of a program must agree on: all of stdout, how it ended and, of stderr, what told() keeps. Below an error that nothing caught stand frames, which an executable names otherwise.
 * A run that ended otherwise and names no such error was ended by something else: the head of its stderr says by what.
 */
function ended(ran: { stdout: string; stderr: string; exitCode: number }) {
  const { stderr, exitCode } = told(ran);
  const death = exitCode !== 0 && stderr === "" ? { death: ran.stderr.slice(0, 2000) } : {};
  return { stdout: ran.stdout, stderr, exitCode, ...death };
}

export async function aFewOfEverySweepIn(part: number, parts: number) {
  const mine = readdirSync(writers)
    .filter(name => /^write-.*-sweep\.ts$/.test(name) && !asidesFromThese.has(name))
    .sort()
    .filter((_, at) => at % parts === part - 1);
  // A writer is a process of its own, and with a sanitizer it holds a third of a gigabyte. Four at once hold less than two cases that run side by side, however many processors the machine has.
  const written: Awaited<ReturnType<typeof programsOf>>[] = [];
  for (let from = 0; from < mine.length; from += 4)
    written.push(...(await Promise.all(mine.slice(from, from + 4).map(programsOf))));
  for (const [at, writer] of mine.entries()) {
    for (const { name, entry, flags, files } of written[at]) {
      test(`${writer.slice("write-".length, -"-sweep.ts".length)}: ${name}`, async () => {
        using home = tempDir("aot-one-of-a-sweep", files);
        const folder = String(home);
        const executable = join(folder, "program" + (isWindows ? ".exe" : ""));
        const [plain, build] = await Promise.all([
          run([bunExe(), "./" + entry], folder, bunEnv),
          run(
            [bunExe(), "build", "--compile", "--aot", checked, ...flags, "./" + entry, "--outfile", executable],
            folder,
            bunEnv,
          ),
        ]);
        const reference = ended(plain);
        // A program that said nothing and ended well would be the same as any other that did. One that ended otherwise names the error that nothing caught: what a signal or a sanitizer ends names none.
        expect(reference).toEqual(
          reference.exitCode === 0
            ? { ...reference, stdout: expect.stringMatching(/./s) }
            : { ...reference, stderr: expect.stringMatching(/./s), exitCode: 1 },
        );
        if (refused.has(name)) {
          expect({
            errors: build.stderr.split("\n").filter(line => line.startsWith("error: ")),
            exitCode: build.exitCode,
            hasWritten: existsSync(executable),
          }).toEqual({ errors: [refusal], exitCode: 1, hasWritten: false });
          return;
        }
        built(build);
        expect(ended(await run([executable], folder, bunEnv))).toEqual(reference);
      });
    }
  }
}
