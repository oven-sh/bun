import { expect } from "bun:test";
import { bunEnv, bunExe, isLinux, libcPathForDlopen, tempDir } from "harness";
import { chmodSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { refusesExecuteOnlyStart } from "./execute-only-start";
import { beforeAll, describe, test } from "./supported";

const program = `import { writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
writeFileSync(process.argv[2], "");
const server = createServer((request, response) => response.end("served"));
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const answer = await (await fetch("http://127.0.0.1:" + (server.address() as AddressInfo).port)).text();
server.close();
const worker = new Worker("./worker.ts");
worker.onmessage = event => {
  console.log(answer, event.data);
  worker.terminate();
};
`;
const worker = `postMessage([3, 4].map(side => side * side).join());
`;

// The process dies of SIGSYS at its first mremap(), from execve() on.
const launcher = `import { dlopen, FFIType, ptr } from "bun:ffi";
const libc = dlopen(${JSON.stringify(isLinux ? libcPathForDlopen() : "")}, {
  prctl: { args: [FFIType.i32, FFIType.u64, FFIType.u64, FFIType.u64, FFIType.u64], returns: FFIType.i32 },
  execv: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
});
const load = 0x20, jumpIfEqual = 0x15, answer = 0x06, allow = 0x7fff0000, killProcess = 0x80000000;
const systemCall = 0, mremap = process.arch === "arm64" ? 216 : 25;
const instructions = [[load, 0, 0, systemCall], [jumpIfEqual, 0, 1, mremap], [answer, 0, 0, killProcess], [answer, 0, 0, allow]];
const filter = new Uint8Array(instructions.length * 8);
const view = new DataView(filter.buffer);
instructions.forEach(([code, ifTrue, ifFalse, operand], i) => {
  view.setUint16(i * 8, code, true);
  view.setUint8(i * 8 + 2, ifTrue);
  view.setUint8(i * 8 + 3, ifFalse);
  view.setUint32(i * 8 + 4, operand, true);
});
const filterProgram = new BigUint64Array([BigInt(instructions.length), BigInt(ptr(filter))]);
const words = process.argv.slice(2).map(word => Buffer.from(word + "\\0"));
const argv = new BigUint64Array([...words.map(word => BigInt(ptr(word))), 0n]);
if (libc.symbols.prctl(38, 1, 0, 0, 0)) throw new Error("PR_SET_NO_NEW_PRIVS was refused");
if (libc.symbols.prctl(22, 2, ptr(filterProgram), 0, 0)) throw new Error("the filter was refused");
libc.symbols.execv(ptr(words[0]), ptr(argv));
throw new Error("execv failed");
`;

let directory: ReturnType<typeof tempDir>;
let executable: string;
let runs = 0;

/** `ran`: whether the program's first statement did. */
async function start(command: (mark: string) => string[]) {
  const mark = join(String(directory), `ran-${runs++}`);
  await using proc = Bun.spawn({ cmd: command(mark), env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signalCode: proc.signalCode, ran: existsSync(mark) };
}

const started = { stdout: "served 9,16\n", stderr: "", exitCode: 0, signalCode: null, ran: true };
const refused = {
  stdout: "",
  stderr:
    "error: can't run this executable's compiled code: the executable's own file can't be opened for reading, and this build of Bun doesn't run without that\n",
  exitCode: 1,
  signalCode: null,
  ran: false,
};

function copyWithMode(mode: number) {
  const copy = `${executable}-${mode.toString(8)}`;
  if (existsSync(copy)) return copy;
  copyFileSync(executable, copy);
  chmodSync(copy, mode);
  return copy;
}

const readsEveryFile = process.getuid?.() === 0;
const withoutRandomAddresses = ["setarch", process.arch === "arm64" ? "aarch64" : "x86_64", "-R"];

describe.skipIf(!isLinux)("an executable", () => {
  beforeAll(async () => {
    directory = tempDir("aot-execute-only-start", {
      "program.ts": program,
      "worker.ts": worker,
      "launcher.ts": launcher,
    });
    executable = join(String(directory), "program");
    const sources = ["program.ts", "worker.ts"].map(name => join(String(directory), name));
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--aot", ...sources, "--outfile", executable],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect({ stderr: await proc.stderr.text(), exitCode: await proc.exited }).toEqual({
      stderr: expect.any(String),
      exitCode: 0,
    });
  }, 120_000);

  test("that can read its own file starts, serves and runs a worker without a call of mremap()", async () => {
    expect(await start(mark => [executable, mark])).toEqual(started);
    expect(await start(mark => [bunExe(), join(String(directory), "launcher.ts"), executable, mark])).toEqual(started);
  }, 60_000);

  describe.skipIf(!refusesExecuteOnlyStart || readsEveryFile)("of a build with --execute-only-start=off", () => {
    test("that may be run but not read exits before its first statement", async () => {
      const unreadable = copyWithMode(0o111);
      expect(await start(mark => [unreadable, mark])).toEqual(refused);
      expect(await start(mark => [bunExe(), join(String(directory), "launcher.ts"), unreadable, mark])).toEqual(
        refused,
      );
    }, 60_000);

    test.skipIf(!Bun.which("setarch"))(
      "does so with ASLR disabled too",
      async () => {
        const unreadable = copyWithMode(0o111);
        expect(await start(mark => [...withoutRandomAddresses, unreadable, mark])).toEqual(refused);
        expect(await start(mark => [...withoutRandomAddresses, executable, mark])).toEqual(started);
      },
      60_000,
    );

    test("that its owner alone may read starts for its owner", async () => {
      expect(await start(mark => [copyWithMode(0o711), mark])).toEqual(started);
    }, 60_000);
  });
});
