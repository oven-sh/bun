import { expect } from "bun:test";
import { bunEnv, bunExe, isMacOS, isWindows, libcPathForDlopen, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

const program = `const worker = new Worker("./worker.ts");
await new Promise<void>(resolve => (worker.onmessage = () => resolve()));
await worker.terminate();
console.log("terminated");
`;
const worker = `postMessage("started");
let turns = 0;
for (;;) turns = (turns + 1) | 0;
`;

// A signal mask stays across execve().
const launcher = `import { dlopen, FFIType, ptr } from "bun:ffi";
const libc = dlopen(${JSON.stringify(isMacOS ? "/usr/lib/libSystem.B.dylib" : isWindows ? "" : libcPathForDlopen())}, {
  pthread_sigmask: { args: [FFIType.i32, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  execv: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
});
const block = ${isMacOS ? 1 : 0};
const everySignal = new Uint8Array(128).fill(0xff);
if (libc.symbols.pthread_sigmask(block, ptr(everySignal), null)) throw new Error("pthread_sigmask failed");
const words = process.argv.slice(2).map(word => Buffer.from(word + "\\0"));
const argv = new BigUint64Array([...words.map(word => BigInt(ptr(word))), 0n]);
libc.symbols.execv(ptr(words[0]), ptr(argv));
throw new Error("execv failed");
`;

test.skipIf(isWindows)(
  "a worker in a loop is terminated in an executable that inherits a mask of every signal",
  async () => {
    using directory = tempDir("aot-inherited-signal-mask", {
      "main.ts": program,
      "worker.ts": worker,
      "launcher.ts": launcher,
    });
    const executable = join(String(directory), "main");
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--aot", "main.ts", "worker.ts", "--outfile", executable],
      cwd: String(directory),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect({ stderr: await build.stderr.text(), exitCode: await build.exited }).toMatchObject({ exitCode: 0 });
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(String(directory), "launcher.ts"), executable],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toEqual({
      stdout: "terminated\n",
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  },
);
