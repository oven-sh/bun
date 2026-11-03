import { expect } from "bun:test";
import { bunEnv, bunExe, libcPathForDlopen, tempDir } from "harness";
import { join } from "node:path";
import { hasGuardedPages } from "./hardened";
import { run } from "./harness/run";
import { beforeAll, describe, test } from "./supported";

const startsThreadsAndWorkers = `await new Promise(resolve => gzip("on another thread", resolve));
let answers = 0;
for (let round = 0; round < 2; round++) {
  await Promise.all(
    Array.from({ length: 4 }, () =>
      new Promise(resolve => {
        const worker = new Worker("./worker.js");
        worker.onmessage = () => {
          answers++;
          worker.terminate();
          resolve();
        };
      }),
    ),
  );
}
console.log(answers, "workers answered");
`;

const programThatForbidsItselfTheCall = `import { dlopen, FFIType, ptr } from "bun:ffi";
import { gzip } from "node:zlib";
const libc = dlopen(${JSON.stringify(process.platform === "linux" ? libcPathForDlopen() : "")}, {
  prctl: { args: [FFIType.i32, FFIType.u64, FFIType.u64, FFIType.u64, FFIType.u64], returns: FFIType.i32 },
  syscall: { args: [FFIType.i64, FFIType.u64, FFIType.u64, FFIType.ptr], returns: FFIType.i64 },
});
const load = 0x20, jumpIfEqual = 0x15, answer = 0x06, allow = 0x7fff0000, killTheProcess = 0x80000000;
const systemCall = 0, setFilter = 1, forEveryThread = 1;
const [personality, seccomp] = process.arch === "arm64" ? [92, 277] : [135, 317];
const instructions = [
  [load, 0, 0, systemCall], [jumpIfEqual, 0, 1, personality], [answer, 0, 0, killTheProcess],
  [answer, 0, 0, allow],
];
const filter = new Uint8Array(instructions.length * 8);
const view = new DataView(filter.buffer);
instructions.forEach(([code, ifTrue, ifFalse, operand], i) => {
  view.setUint16(i * 8, code, true);
  view.setUint8(i * 8 + 2, ifTrue);
  view.setUint8(i * 8 + 3, ifFalse);
  view.setUint32(i * 8 + 4, operand, true);
});
const filterProgram = new BigUint64Array([BigInt(instructions.length), BigInt(ptr(filter))]);
if (libc.symbols.prctl(38, 1, 0, 0, 0)) throw new Error("PR_SET_NO_NEW_PRIVS was refused");
if (libc.symbols.syscall(seccomp, setFilter, forEveryThread, ptr(filterProgram))) throw new Error("the filter was refused");
${startsThreadsAndWorkers}`;

describe.skipIf(!hasGuardedPages)("a Bun built with --hardened=on", () => {
  let directory: ReturnType<typeof tempDir>;
  const pathOf = (name: string) => join(String(directory), name);

  beforeAll(async () => {
    directory = tempDir("aot-hardened-personality", {
      "forbids.js": programThatForbidsItselfTheCall,
      "worker.js": `postMessage("done");\n`,
    });
    const sources = [pathOf("forbids.js"), pathOf("worker.js")];
    const built = await run([bunExe(), "build", "--compile", "--aot", ...sources, "--outfile", pathOf("forbids")]);
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
  }, 120_000);

  test.each<[string, () => string[]]>([
    ["an executable that it compiled ahead of time", () => [pathOf("forbids")]],
    ["a program that it runs from source", () => [bunExe(), "run", pathOf("forbids.js")]],
  ])(
    "%s starts threads and workers after it has forbidden itself to ask for its personality",
    async (_, command) => {
      expect(await run(command(), String(directory), bunEnv)).toEqual({
        stdout: "8 workers answered\n",
        stderr: "",
        exitCode: 0,
      });
    },
    120_000,
  );
});
