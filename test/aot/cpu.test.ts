// A program is compiled for the CPU that Bun itself is compiled for: on ARM64 the oldest one on Linux, the M1 on macOS. The M1 converts a number to an int32 in
// one instruction, so a Mac runs other code for `x | 0` than any Linux machine. --aot-cpu=apple-m1 compiles that code on every ARM64 machine, and one that has
// the instructions runs it: AOT_BUILD_FLAGS, run-parallel.ts --more-flags and fuzz/run.ts --flags hand the flag to whole suites.
import { expect } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, isArm64, isLinux, isWindows, tempDir } from "harness";
import { join } from "path";
import { slot, spawned, unsupported } from "./harness/commands";
import { test } from "./harness/default-timeout";

const program = `const values = [0.5, -0.5, 4294967297.5, -2147483649, 2147483648, NaN, Infinity, -0, 1e300, -1e19];
function toInt32(value: number) { return value | 0; }
function isInt32(value: number) { return (value | 0) === value; }
console.log(values.map(toInt32).join(), values.map(isInt32).join());
`;

const build = (folder: string, name: string, ...flags: string[]) =>
  spawned([bunExe(), "build", "--compile", "--aot", ...flags, "program.ts", "--outfile", name], folder, bunEnv);

// FJCVTZS <Wd>, <Dn>
function conversionsInOneInstruction(file: string) {
  const bytes = readFileSync(file);
  const words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 2);
  let count = 0;
  for (const word of words) if ((word & 0xfffffc00) >>> 0 === 0x1e7e0000) count++;
  return count;
}

test.skipIf(!!unsupported || !isArm64 || isWindows)("a program compiled for the M1 answers as ever", async () => {
  await slot(async () => {
    using dir = tempDir("aot-cpu", { "program.ts": program });
    const folder = String(dir);
    expect((await build(folder, "own")).exitCode).toBe(0);
    expect((await build(folder, "m1", "--aot-cpu=apple-m1")).exitCode).toBe(0);
    if (isLinux)
      expect(conversionsInOneInstruction(join(folder, "m1"))).toBeGreaterThan(
        conversionsInOneInstruction(join(folder, "own")),
      );
    const { stdout: answer } = await spawned([bunExe(), "program.ts"], folder, bunEnv);
    expect(answer).toStartWith("0,0,1,2147483647,-2147483648,0,0,0,0,");
    const own = await spawned([join(folder, "own")], folder, bunEnv);
    expect({ stdout: own.stdout, stderr: own.stderr, exitCode: own.exitCode }).toEqual({
      stdout: answer,
      stderr: "",
      exitCode: 0,
    });
    const m1 = await spawned([join(folder, "m1")], folder, bunEnv);
    // A CPU without the instructions is told so before any of them runs.
    if (m1.exitCode) expect(m1.stderr).toContain("it was built with different engine options than this process uses");
    else expect({ stdout: m1.stdout, stderr: m1.stderr }).toEqual({ stdout: answer, stderr: "" });
  });
});

const atomics = `const cells = new Int32Array(new SharedArrayBuffer(64));
function count(turns: number) {
  let sum = 0;
  for (let i = 0; i < turns; i++)
    sum = (sum + Atomics.add(cells, 0, i) + Atomics.and(cells, 1, i) + Atomics.exchange(cells, 2, i) + Atomics.compareExchange(cells, 3, i - 1, i)) | 0;
  return sum;
}
console.log(count(100));
`;

// What later CPUs have and the compiler can use: FJCVTZS; CAS, CASP; SWP, LDADD and their kin; FRINT32Z and its kin.
function newerInstruction(word: number) {
  if ((word & 0xfffffc00) >>> 0 === 0x1e7e0000) return "fjcvtzs";
  if ((word & 0x3fa07c00) >>> 0 === 0x08a07c00 || (word & 0xbfa07c00) >>> 0 === 0x08207c00) return "cas";
  if ((word & 0x3f200c00) >>> 0 === 0x38200000) return "an atomic operation on memory";
  if ((word & 0xffbe7c00) >>> 0 === 0x1e284000) return "frint";
}

/** Which of them the functions and the stubs of an executable hold. The compiler's map says where each of those lies in the code of the image. */
function newerInstructionsOf(executable: Buffer, map: string) {
  let code: Buffer | undefined;
  for (
    let at = executable.indexOf("BUNAOT01", 0, "latin1");
    at >= 0 && !code;
    at = executable.indexOf("BUNAOT01", at + 1, "latin1")
  ) {
    if (at + 56 > executable.length) break;
    const [size, offset, length] = [32, 40, 48].map(field => Number(executable.readBigUInt64LE(at + field)));
    if (length > 0 && offset + length <= size && at + size <= executable.length)
      code = executable.subarray(at + offset, at + offset + length);
  }
  if (!code) throw new Error("the executable holds no image of compiled code");
  const pieces: { start: number; end?: number }[] = [];
  for (const fields of map.split("\n").map(line => line.split("\t"))) {
    if (fields[0] === "F") pieces.push({ start: Number(fields[2]), end: Number(fields[2]) + Number(fields[3]) });
    else if (fields[0] === "T") pieces.push({ start: Number(fields[1]) });
  }
  pieces.sort((one, other) => one.start - other.start);
  const found = new Set<string>();
  let words = 0;
  pieces.forEach(({ start, end }, index) => {
    for (let at = start; at + 4 <= (end ?? pieces[index + 1]?.start ?? start); at += 4, words++) {
      const newer = newerInstruction(code.readUInt32LE(at));
      if (newer) found.add(newer);
    }
  });
  expect(words).toBeGreaterThan(1000);
  return [...found].sort();
}

// The machines that test this have every one of them. Had the compiler asked the machine that it runs on, the program would stop on a Raspberry Pi 4.
test.skipIf(!!unsupported || !isArm64 || !isLinux)(
  "on Linux no compiled instruction is newer than the oldest CPU",
  async () => {
    await slot(async () => {
      using dir = tempDir("aot-cpu", { "program.ts": program + atomics });
      const folder = String(dir);
      const newerIn = async (name: string, ...flags: string[]) => {
        const map = join(folder, name + ".map");
        const built = await spawned(
          [bunExe(), "build", "--compile", "--aot", ...flags, "program.ts", "--outfile", name],
          folder,
          { ...bunEnv, BUN_JSC_aotMapFilePath: map },
        );
        expect(built.exitCode).toBe(0);
        return newerInstructionsOf(readFileSync(join(folder, name)), readFileSync(map, "latin1"));
      };
      expect(await newerIn("own")).toEqual([]);
      // The scan finds them where they are.
      expect(await newerIn("m1", "--aot-cpu=apple-m1")).toEqual(
        expect.arrayContaining(["an atomic operation on memory", "cas", "fjcvtzs"]),
      );
    });
  },
);

test.skipIf(!!unsupported)("a CPU that the compiler does not know is refused by name", async () => {
  await slot(async () => {
    using dir = tempDir("aot-cpu", { "program.ts": program });
    const refused = await build(String(dir), "other", "--aot-cpu=apple-m0");
    expect({ stderr: refused.stderr, exitCode: refused.exitCode }).toEqual({
      stderr: expect.stringContaining("--aot-cpu=apple-m0: unknown CPU apple-m0"),
      exitCode: 1,
    });
  });
});
