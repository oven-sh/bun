import { expect } from "bun:test";
import { bunExe, isLinux, libcPathForDlopen, tempDir } from "harness";
import { join } from "node:path";
import { isHardened } from "./hardened";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

const program = `import { cc, dlopen, FFIType } from "bun:ffi";
const libc = dlopen(${JSON.stringify(isLinux ? libcPathForDlopen() : "")}, {
  prctl: { args: [FFIType.i32, FFIType.u64, FFIType.u64, FFIType.u64, FFIType.u64], returns: FFIType.i32 },
  mmap: { args: [FFIType.ptr, FFIType.u64, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.i64], returns: FFIType.i64 },
});
const getMDWE = 66, read = 1, write = 2, execute = 4, isPrivate = 2, isAnonymous = 0x20;
const bits = libc.symbols.prctl(getMDWE, 0, 0, 0, 0);
const isGranted = libc.symbols.mmap(null, 4096, read | write | execute, isPrivate | isAnonymous, -1, 0) !== -1n;
let compiler: unknown;
try {
  compiler = cc({ source: process.argv[2], symbols: { twice: { args: ["int"], returns: "int" } } }).symbols.twice(21);
} catch (error) {
  compiler = (error as { code?: string }).code;
}
console.log(JSON.stringify({ bits, isGranted, compiler }));
`;

const child = `const { stdout } = Bun.spawnSync({ cmd: [process.argv[2], "-e", "console.log(1 + 1)"], stdout: "pipe" });
process.stdout.write(stdout);
`;

async function run(cmd: string[]) {
  const { stdout, stderr, exitCode } = await runCommand(cmd);
  return { stdout, stderr, exitCode };
}

async function build(directory: string, name: string) {
  const executable = join(directory, name);
  const built = await run([
    bunExe(),
    "build",
    "--compile",
    "--aot",
    join(directory, name + ".ts"),
    "--outfile",
    executable,
  ]);
  expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
  return executable;
}

test.skipIf(!isLinux)(
  "an executable denies itself writable and executable memory where the kernel supports it",
  async () => {
    using dir = tempDir("aot-mdwe", { "program.ts": program, "twice.c": "int twice(int x) { return 2 * x; }\n" });
    const { stdout, stderr, exitCode } = await run([await build(String(dir), "program"), join(String(dir), "twice.c")]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const state = JSON.parse(stdout);
    expect([isHardened ? 1 : 3, 0, -1]).toContain(state.bits);
    if (state.bits > 0 || isHardened)
      expect(state).toMatchObject({ isGranted: false, compiler: "ERR_FFI_CC_DISABLED" });
    else expect(state).toMatchObject({ isGranted: true, compiler: 42 });
  },
  120_000,
);

test.skipIf(!isLinux || isHardened)(
  "a child process keeps its JIT",
  async () => {
    using dir = tempDir("aot-mdwe-child", { "child.ts": child });
    expect(await run([await build(String(dir), "child"), bunExe()])).toEqual({
      stdout: "2\n",
      stderr: "",
      exitCode: 0,
    });
  },
  120_000,
);
