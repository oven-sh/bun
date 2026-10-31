import { dlopen, FFIType } from "bun:ffi";
import { afterAll, expect } from "bun:test";
import { bunEnv, bunExe, isLinux, libcPathForDlopen, tempDir } from "harness";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { built, slot, spawned } from "./harness/commands";
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
  // It writes with `console.write`: with `process.stdout` a build holds five times as many functions of Bun's library.
  "starts-another-executable": `const { stdout, exitCode } = Bun.spawnSync({ cmd: process.argv.slice(2), stdout: "pipe", stderr: "inherit" });
console.write(stdout);
process.exitCode = exitCode;
`,
};

const shared = join(import.meta.dir, "without-executable-memory");
const sharedNames = readdirSync(shared)
  .filter(name => name.endsWith(".ts"))
  .map(name => name.slice(0, -3))
  .filter(name => name !== "asks-for-executable-memory")
  .sort();

// What each program prints. A program that is added to the shared folder gets a line here.
const printed: Record<string, string> = {
  "hello": "hello\n",
  "a-worker": "112\n",
  "callbacks-from-foreign-functions": "1,3,5,9\n",
  "classes-maps-and-promises": 'TypeError\n707108.284 42 {"a":[1,2,{"b":"c"}]} 42\n',
  "code-made-at-run-time": "60900000000 44999850000\n",
  "foreign-functions": "5\n",
  "hot-runtime-regexp": "(a+b|c)*d[0-9]{2,}x? 400000 4666660\n",
  "many-runtime-regexps": "8000 a+b+c 1,22,333\n",
  "regions-for-generated-code": "0\n",
  "server-and-client": "hello /199 true 3\n",
  "webassembly": "-1474936480\n",
};

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

/** Started free and started by the launcher, the executable of `name` prints what the program prints. */
async function printsTheSameBothWays(directory: string, name: string) {
  const executable = await build(directory, name);
  const [whenFree, whenInherited] = await Promise.all([
    free([executable], directory),
    inherited([executable], directory),
  ]);
  const expected = { stdout: printed[name], stderr: "", exitCode: 0, signal: null };
  expect(whenFree).toEqual(expected);
  expect(whenInherited).toEqual(expected);
}

// The first two tests start `state`. One folder serves both, and `state` is built once: for the test that asks first.
let folder: ReturnType<typeof tempDir> | undefined;
let stateIsBuilt: Promise<string> | undefined;
afterAll(() => folder?.[Symbol.dispose]());
function folderOfState() {
  folder ??= tempDir("aot-mdwe-inherited", {
    "launcher.ts": launcher,
    "state.ts": state,
    "starts-another-executable.ts": own["starts-another-executable"],
    "twice.c": "int twice(int x) { return 2 * x; }\n",
  });
  return String(folder);
}
const builtState = () => (stateIsBuilt ??= build(folderOfState(), "state"));

// Bun starts the clock of a concurrent test before the test has a slot. So the limit also covers the wait for one.
const queueTimeout = 600_000;

describe.skipIf(!!obstacle)("an executable that is started with memory-deny-write-execute already on", () => {
  test.concurrent(
    "leaves the request as the launcher made it",
    () =>
      slot(async () => {
        const directory = folderOfState();
        expect(await inherited([await builtState(), join(directory, "twice.c")], directory)).toEqual(restricted);
      }),
    queueTimeout,
  );

  test.concurrent(
    "hands it on to an executable that it starts",
    () =>
      slot(async () => {
        const directory = folderOfState();
        const [parent, child] = await Promise.all([build(directory, "starts-another-executable"), builtState()]);
        expect(await inherited([parent, child, join(directory, "twice.c")], directory)).toEqual(restricted);
      }),
    queueTimeout,
  );

  test.concurrent.each(["hello", "a-worker"])(
    "%s",
    name =>
      slot(async () => {
        using dir = tempDir("aot-mdwe-inherited", { "launcher.ts": launcher, [name + ".ts"]: own[name] });
        await printsTheSameBothWays(String(dir), name);
      }),
    queueTimeout,
  );

  test.concurrent.each(sharedNames)(
    "%s",
    name =>
      slot(async () => {
        using dir = tempDir("aot-mdwe-inherited", { "launcher.ts": launcher, "tsconfig.json": tsconfigWithTypesOfBun });
        const directory = String(dir);
        await Bun.write(join(directory, name + ".ts"), Bun.file(join(shared, name + ".ts")));
        await printsTheSameBothWays(directory, name);
      }),
    queueTimeout,
  );
});
