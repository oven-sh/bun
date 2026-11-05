import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isLinux, libcPathForDlopen, tempDir } from "harness";
import { join } from "node:path";
import { isHardened } from "./hardened";
import { withoutCoreDump } from "./harness/commands";
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

// A native library that generates machine code does this: it writes the code to a page, makes the page executable and runs it.
// One that doesn't check what mprotect() answers runs the page anyway.
const jumps = `import { CFunction, dlopen, FFIType, toArrayBuffer } from "bun:ffi";
const libc = dlopen(${JSON.stringify(isLinux ? libcPathForDlopen() : "")}, {
  prctl: { args: [FFIType.i32, FFIType.u64, FFIType.u64, FFIType.u64, FFIType.u64], returns: FFIType.i32 },
  mmap: { args: [FFIType.ptr, FFIType.u64, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.i64], returns: FFIType.i64 },
  mprotect: { args: [FFIType.ptr, FFIType.u64, FFIType.i32], returns: FFIType.i32 },
});
const getMDWE = 66, read = 1, write = 2, execute = 4, isPrivate = 2, isAnonymous = 0x20;
const bits = libc.symbols.prctl(getMDWE, 0, 0, 0, 0);
const page = Number(libc.symbols.mmap(null, 4096, read | write, isPrivate | isAnonymous, -1, 0));
// x64: mov eax, 42; ret. arm64: mov w0, #42; ret
const returns42 = process.arch === "arm64" ? [0x40, 0x05, 0x80, 0x52, 0xc0, 0x03, 0x5f, 0xd6] : [0xb8, 42, 0, 0, 0, 0xc3];
new Uint8Array(toArrayBuffer(page, 0, 4096)).set(returns42);
// On arm64 the instruction cache doesn't see the written bytes until it's told of them.
let isFlushed = process.arch !== "arm64";
try {
  if (!isFlushed) {
    dlopen("libgcc_s.so.1", { __clear_cache: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.void } }).symbols.__clear_cache(page, page + 4096);
    isFlushed = true;
  }
} catch {}
const protect = libc.symbols.mprotect(page, 4096, read | execute);
console.log(JSON.stringify({ bits, protect }));
if (protect === 0 && !isFlushed) console.log("not run");
else console.log(new CFunction({ ptr: page, returns: FFIType.i32, args: [] })());
`;

const child = `const { stdout } = Bun.spawnSync({ cmd: [process.argv[2], "-e", "console.log(1 + 1)"], stdout: "pipe" });
console.write(stdout);
`;

async function run(cmd: string[]) {
  const { stdout, stderr, exitCode } = await runCommand(cmd);
  return { stdout, stderr, exitCode };
}

async function build(directory: string, name: string, ...flags: string[]) {
  const executable = join(directory, name);
  const built = await run([
    bunExe(),
    "build",
    "--compile",
    "--aot",
    ...flags,
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

test.skipIf(!isLinux || isHardened)(
  "an executable built with --aot-allow-executable-memory keeps writable and executable memory",
  async () => {
    using dir = tempDir("aot-mdwe-allowed", {
      "program.ts": program,
      "twice.c": "int twice(int x) { return 2 * x; }\n",
    });
    const executable = await build(String(dir), "program", "--aot-allow-executable-memory");
    const { stdout, stderr, exitCode } = await run([executable, join(String(dir), "twice.c")]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const state = JSON.parse(stdout);
    expect([0, -1]).toContain(state.bits);
    expect(state).toMatchObject({ isGranted: true, compiler: 42 });
  },
  120_000,
);

test.skipIf(isHardened)("--aot-allow-executable-memory requires --aot", async () => {
  using dir = tempDir("aot-mdwe-requires-aot", {
    "program.ts": "console.log(1);\n",
    "build.ts": `try {
  await Bun.build({ entrypoints: ["./program.ts"], compile: { allowExecutableMemory: true, outfile: "./program" } });
} catch (error) {
  console.log((error as Error).message);
}
`,
  });
  const flag = await runCommand(
    [bunExe(), "build", "--compile", "--aot-allow-executable-memory", "program.ts", "--outfile", "program"],
    String(dir),
  );
  expect({ stderr: flag.stderr, exitCode: flag.exitCode }).toEqual({
    stderr: "error: --aot-allow-executable-memory requires --aot\n",
    exitCode: 1,
  });
  const runs = await runCommand([bunExe(), "--aot-allow-executable-memory", "program.ts"], String(dir));
  expect({ stderr: runs.stderr, exitCode: runs.exitCode }).toEqual({
    stderr: "error: --aot-allow-executable-memory requires --aot\n",
    exitCode: 1,
  });
  const key = await runCommand([bunExe(), "build.ts"], String(dir), { ...bunEnv, NO_COLOR: "1" });
  expect({ stdout: key.stdout, exitCode: key.exitCode }).toEqual({
    stdout: "compile.allowExecutableMemory requires compile.aot: true\n",
    exitCode: 0,
  });
});

test.skipIf(!isLinux || isHardened || isASAN)(
  "a crash in code that the denial kept from becoming executable says so",
  async () => {
    using dir = tempDir("aot-mdwe-crash", { "jumps.ts": jumps });
    const executable = await build(String(dir), "jumps");
    const { stdout, stderr, exitCode } = await runCommand(
      withoutCoreDump([executable, "--debug-crash-handler-use-trace-string"]),
      String(dir),
      { ...bunEnv, BUN_ENABLE_CRASH_REPORTING: "0", BUN_CRASH_REPORT_URL: "" },
    );
    const [first, ...rest] = stdout.split("\n");
    const state = JSON.parse(first);
    if (state.bits > 0) {
      expect({ protect: state.protect, rest }).toEqual({ protect: -1, rest: [""] });
      expect(stderr).toContain("Bun has crashed while running code in memory that isn't executable");
      expect(stderr).toContain("--aot-allow-executable-memory");
      expect(stderr).not.toContain("bug in Bun");
      expect(exitCode).not.toBe(0);
    } else {
      expect({ protect: state.protect, rest, stderr, exitCode }).toEqual({
        protect: 0,
        rest: [process.arch === "arm64" ? expect.stringMatching(/^(42|not run)$/) : "42", ""],
        stderr: "",
        exitCode: 0,
      });
    }
  },
  120_000,
);
