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
