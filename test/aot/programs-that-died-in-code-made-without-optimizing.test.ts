// In a very large program the functions that are not hot are compiled without optimizing, by a generator of its own with an arm for each processor.
// `--aot-testing=GenerateAllCodeDirectly` compiles every function that way. ./joined-programs.ts tries it on three groups of programs in a run, others for each
// commit. The programs here have died or answered wrongly that way, so every run takes them.
//
// No machine that runs one of these lanes can be asked afterwards, so where a program dies this test prints what is needed to read the fault: what the executable
// said, the code of the program's own functions, and the code around each place of the stack that lies in compiled code. A line `CODE <name> <offset> <bytes in hexadecimal>`.
import { expect } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { bunEnv, bunExe, isASAN, isWindows, tempDir } from "harness";
import { basename, join } from "path";
import { built, slot, spawned, withoutCoreDump } from "./run-programs";
import { test } from "./supported";

const programs = [
  "type-rules/loop-bounds-that-arrive-boxed.ts",
  "structural-types/typed-arrays-are-read-past-their-end-into-an-int32.ts",
  "typed-objects/null-checks-of-narrow-references.ts",
  "language/a-case-that-is-compiled-right-behind-its-switch-reads-its-own-registers.ts",
  "language/a-shift-of-32-bits-is-no-part-of-a-64-bit-sum.ts",
  "language/a-value-of-32-bits-feeds-a-phi-of-64-bits-in-the-same-frame-slot.ts",
  "language/an-index-shifted-in-32-bits-wraps-before-it-is-an-address.ts",
  "language/equalities-joined-by-or-and-switches-within-64-values.ts",
  "language/int32-read-once-used-variously.ts",
  "language/switch-cases-share-targets.ts",
  "language/the-copies-at-the-end-of-a-block-outnumber-the-registers.ts",
  "language/untyped-value-vs-many-integers.js",
  "structural-types/a-switch-over-a-sparse-enum-gets-numbers-that-wrap-around-to-a-member.ts",
  "structural-types/enum-typed-fields-elements-and-variables-hold-any-number.ts",
]
  .filter(name => !existsSync(join(import.meta.dir, "programs", name.replace(/\.[a-z]+$/, ".todo.txt"))))
  // The pinned engine fails an assertion where it gives up on a function of this program. Only the build with AddressSanitizer has assertions.
  .filter(name => !isASAN || name !== "language/the-copies-at-the-end-of-a-block-outnumber-the-registers.ts");

function codeOf(executable: Buffer) {
  const magic = Buffer.from("BUNAOT01", "latin1");
  for (let at = executable.indexOf(magic); at >= 0; at = executable.indexOf(magic, at + 1)) {
    if (at + 56 > executable.length) break;
    const size = Number(executable.readBigUInt64LE(at + 32));
    const codeOffset = Number(executable.readBigUInt64LE(at + 40));
    const codeSize = Number(executable.readBigUInt64LE(at + 48));
    if (codeSize > 0 && codeOffset + codeSize <= size && at + size <= executable.length)
      return executable.subarray(at + codeOffset, at + codeOffset + codeSize);
  }
  return Buffer.alloc(0);
}

/** The offsets in compiled code among the frames of a crash report's link. */
function compiledFramesOf(report: string): number[] {
  const digits = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const text = /\/\d+\.\d+\.\d+\/...[0-9a-f]{7}(\S*)/.exec(report)?.[1] ?? "";
  let at = 0;
  const number = () => {
    let value = 0;
    for (let shift = 0; at < text.length; shift += 5) {
      const digit = digits.indexOf(text[at++]);
      if (digit < 0) return undefined;
      value += (digit & 31) * 2 ** shift;
      if (!(digit & 32)) break;
    }
    return Math.floor(value / 2);
  };
  number();
  number();
  const offsets: number[] = [];
  while (at < text.length && text[at] !== "A") {
    if (text[at] === "_") at++;
    else if (number() === 1) {
      const length = number() ?? 0;
      if (text.slice(at, at + 3) !== "aot") continue;
      at += length;
      offsets.push((number() ?? 0) + 1);
    }
  }
  return offsets;
}

function printEvidence(name: string, stderr: string, executable: string, mapPath: string) {
  const code = codeOf(readFileSync(executable));
  const lines = [`DIED: ${name}`, stderr];
  const show = (label: string, start: number, end: number) =>
    lines.push(`CODE ${label} ${start} ${code.toString("hex", Math.max(start, 0), Math.min(end, code.length))}`);
  for (const line of readFileSync(mapPath, "utf8").split("\n")) {
    const fields = line.split("\t");
    if (fields[0] === "F" && fields[10]?.endsWith(basename(name)))
      show(fields[7] || "(module)", Number(fields[2]), Number(fields[2]) + Number(fields[3]));
  }
  for (const offset of compiledFramesOf(stderr).slice(0, 6)) show(`(frame at ${offset})`, offset - 512, offset + 64);
  console.error(lines.join("\n"));
}

test.concurrent.each(programs)(
  "%s",
  name =>
    slot(async () => {
      const program = join(import.meta.dir, "programs", name);
      using dir = tempDir("aot-died-without-optimizing", {});
      const folder = String(dir);
      const executable = join(folder, isWindows ? "program.exe" : "program");
      const mapPath = join(folder, "program.map");
      const plain = await spawned([bunExe(), "run", program], folder, bunEnv);
      built(
        await spawned(
          [
            bunExe(),
            "build",
            "--compile",
            "--aot",
            "--aot-threads=1",
            "--aot-testing=GenerateAllCodeDirectly",
            program,
            "--outfile",
            executable,
          ],
          folder,
          { ...bunEnv, BUN_JSC_aotMapFilePath: mapPath },
        ),
      );
      const ran = await spawned(withoutCoreDump([executable]), folder, bunEnv);
      if (ran.signal) printEvidence(name, ran.stderr, executable, mapPath);
      expect({ signal: ran.signal, exitCode: ran.exitCode, stdout: ran.stdout }).toEqual({
        signal: null,
        exitCode: plain.exitCode,
        stdout: plain.stdout,
      });
    }),
  240_000,
);
