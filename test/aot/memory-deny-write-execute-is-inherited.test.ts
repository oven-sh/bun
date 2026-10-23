import { dlopen, FFIType } from "bun:ffi";
import { expect } from "bun:test";
import { bunEnv, bunExe, isLinux, libcPathForDlopen, tempDir } from "harness";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { built, spawned } from "./run-programs";
import { describe, test } from "./supported";

const libc = JSON.stringify(isLinux ? libcPathForDlopen() : "");
const prctl =
  "prctl: { args: [FFIType.i32, FFIType.u64, FFIType.u64, FFIType.u64, FFIType.u64], returns: FFIType.i32 }";

const launcher = `import { dlopen, FFIType, ptr } from "bun:ffi";
const libc = dlopen(${libc}, { ${prctl}, execv: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 } });
const setMDWE = 65, refuseExecGain = 1;
const command = process.argv.slice(2).map(argument => Buffer.from(argument + "\\0"));
const argv = new BigUint64Array([...command.map(argument => BigInt(ptr(argument))), 0n]);
const path = ptr(command[0]), list = ptr(argv);
if (libc.symbols.prctl(setMDWE, refuseExecGain, 0, 0, 0)) throw new Error("PR_SET_MDWE was refused");
libc.symbols.execv(path, list);
throw new Error("execv failed");
`;

const state = `import { cc, dlopen, FFIType } from "bun:ffi";
const libc = dlopen(${libc}, {
  ${prctl},
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

const own: Record<string, string> = {
  "hello": `console.log("hello");\n`,
  "a-worker": `declare var self: Worker;
if (Bun.isMainThread) {
  let sum = 0;
  for (let round = 0; round < 3; round++) {
    const worker = new Worker(import.meta.url);
    sum += await new Promise<number>(resolve => {
      worker.onmessage = event => resolve(event.data);
      worker.postMessage(round);
    });
    await worker.terminate();
  }
  console.log(sum);
} else {
  self.onmessage = event => {
    const twice = new Function("n", "return n * 2");
    self.postMessage(twice(event.data) + (new RegExp("^a{" + (event.data + 1) + "}$").test("aaa") ? 100 : 0) + "x1y22".match(/\\d+/g)!.length);
  };
}
`,
  "starts-another-executable": `const { stdout, exitCode } = Bun.spawnSync({ cmd: process.argv.slice(2), stdout: "pipe", stderr: "inherit" });
process.stdout.write(stdout);
process.exitCode = exitCode;
`,
};

const shared = join(import.meta.dir, "without-executable-memory");
const sharedNames = readdirSync(shared)
  .filter(name => name.endsWith(".ts"))
  .map(name => name.slice(0, -3))
  .filter(name => name !== "asks-for-executable-memory")
  .sort();

function whyItCannotBeShown() {
  const getMDWE = 66;
  try {
    const { symbols } = dlopen(libcPathForDlopen(), {
      prctl: { args: [FFIType.i32, FFIType.u64, FFIType.u64, FFIType.u64, FFIType.u64], returns: FFIType.i32 },
    });
    return symbols.prctl(getMDWE, 0, 0, 0, 0) < 0 ? "this kernel has no PR_SET_MDWE, which came with Linux 6.3" : "";
  } catch (error) {
    return String(error);
  }
}
const obstacle = isLinux ? whyItCannotBeShown() : "it is a request to Linux";
if (isLinux && obstacle) console.error(`SKIPPED: test/aot/memory-deny-write-execute-is-inherited.test.ts: ${obstacle}`);

const tsconfigWithTypesOfBun = JSON.stringify({
  compilerOptions: { strict: true, typeRoots: [join(import.meta.dir, "..", "..", "packages")], types: ["bun-types"] },
});

async function build(directory: string, name: string) {
  const executable = join(directory, name);
  built(
    await spawned(
      [bunExe(), "build", "--compile", "--aot", join(directory, name + ".ts"), "--outfile", executable],
      directory,
      bunEnv,
    ),
  );
  return executable;
}

const free = (cmd: string[], directory: string) => spawned(cmd, directory, bunEnv);
const inherited = (cmd: string[], directory: string) =>
  spawned([bunExe(), join(directory, "launcher.ts"), ...cmd], directory, bunEnv);
const restricted = {
  stdout: JSON.stringify({ bits: 1, isGranted: false, compiler: "ERR_FFI_CC_DISABLED" }) + "\n",
  stderr: "",
  exitCode: 0,
  signal: null,
};

describe.skipIf(!!obstacle)("an executable that is started with memory-deny-write-execute already on", () => {
  test("leaves the request as the launcher made it", async () => {
    using dir = tempDir("aot-mdwe-inherited", {
      "launcher.ts": launcher,
      "state.ts": state,
      "twice.c": "int twice(int x) { return 2 * x; }\n",
    });
    const directory = String(dir);
    expect(await inherited([await build(directory, "state"), join(directory, "twice.c")], directory)).toEqual(
      restricted,
    );
  }, 120_000);

  test("hands it on to an executable that it starts", async () => {
    using dir = tempDir("aot-mdwe-inherited", {
      "launcher.ts": launcher,
      "state.ts": state,
      "starts-another-executable.ts": own["starts-another-executable"],
      "twice.c": "int twice(int x) { return 2 * x; }\n",
    });
    const directory = String(dir);
    const [parent, child] = [await build(directory, "starts-another-executable"), await build(directory, "state")];
    expect(await inherited([parent, child, join(directory, "twice.c")], directory)).toEqual(restricted);
  }, 120_000);

  test.each(["hello", "a-worker"])(
    "%s",
    async name => {
      using dir = tempDir("aot-mdwe-inherited", { "launcher.ts": launcher, [name + ".ts"]: own[name] });
      const directory = String(dir);
      const executable = await build(directory, name);
      const expected = await free([executable], directory);
      expect(expected).toEqual({ stdout: expect.stringMatching(/./), stderr: "", exitCode: 0, signal: null });
      expect(await inherited([executable], directory)).toEqual(expected);
    },
    120_000,
  );

  test.each(sharedNames)(
    "%s",
    async name => {
      using dir = tempDir("aot-mdwe-inherited", { "launcher.ts": launcher, "tsconfig.json": tsconfigWithTypesOfBun });
      const directory = String(dir);
      await Bun.write(join(directory, name + ".ts"), Bun.file(join(shared, name + ".ts")));
      const executable = await build(directory, name);
      const expected = await free([executable], directory);
      expect(expected).toEqual({ stdout: expect.stringMatching(/./), stderr: "", exitCode: 0, signal: null });
      expect(await inherited([executable], directory)).toEqual(expected);
    },
    120_000,
  );
});
