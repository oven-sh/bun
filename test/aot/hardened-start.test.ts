import { expect } from "bun:test";
import { bunExe, isLinux, libcPathForDlopen, tempDir } from "harness";
import { join } from "node:path";
import { isHardened } from "./hardened";
import { run } from "./harness/run";
import { beforeAll, describe, test } from "./supported";

const program = `import { readFileSync } from "node:fs";
const status = readFileSync("/proc/self/status", "utf8");
const field = (name: string) => Number(new RegExp("^" + name + ":\\\\s*(\\\\d+)", "m").exec(status)?.[1]);
console.log(JSON.stringify({ noNewPrivileges: field("NoNewPrivs"), seccompMode: field("Seccomp") }));
`;

const launcher = `import { dlopen, FFIType, ptr } from "bun:ffi";
const libc = dlopen(${JSON.stringify(isLinux ? libcPathForDlopen() : "")}, {
  prctl: { args: [FFIType.i32, FFIType.u64, FFIType.u64, FFIType.u64, FFIType.u64], returns: FFIType.i32 },
  execv: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
});
const answers: { call: "prctl" | "seccomp"; request?: number; errno: number }[] = JSON.parse(process.argv[3]);
const load = 0x20, jumpIfEqual = 0x15, answer = 0x06, allow = 0x7fff0000, fail = 0x00050000;
const systemCall = 0, firstArgument = 16;
const numbers = process.arch === "arm64" ? { prctl: 167, seccomp: 277 } : { prctl: 157, seccomp: 317 };
const instructions = answers.flatMap(({ call, request, errno }) =>
  request === undefined
    ? [[load, 0, 0, systemCall], [jumpIfEqual, 0, 1, numbers[call]], [answer, 0, 0, fail | errno]]
    : [[load, 0, 0, systemCall], [jumpIfEqual, 0, 3, numbers[call]], [load, 0, 0, firstArgument], [jumpIfEqual, 0, 1, request], [answer, 0, 0, fail | errno]],
);
instructions.push([answer, 0, 0, allow]);
const filter = new Uint8Array(instructions.length * 8);
const view = new DataView(filter.buffer);
instructions.forEach(([code, ifTrue, ifFalse, operand], i) => {
  view.setUint16(i * 8, code, true);
  view.setUint8(i * 8 + 2, ifTrue);
  view.setUint8(i * 8 + 3, ifFalse);
  view.setUint32(i * 8 + 4, operand, true);
});
const filterProgram = new BigUint64Array([BigInt(instructions.length), BigInt(ptr(filter))]);
const path = Buffer.from(process.argv[2] + "\\0");
const argv = new BigUint64Array([BigInt(ptr(path)), 0n]);
const setNoNewPrivileges = 38, setSeccomp = 22, filterMode = 2;
if (libc.symbols.prctl(setNoNewPrivileges, 1, 0, 0, 0)) throw new Error("PR_SET_NO_NEW_PRIVS was refused");
if (libc.symbols.prctl(setSeccomp, filterMode, ptr(filterProgram), 0, 0)) throw new Error("the filter was refused");
libc.symbols.execv(ptr(path), ptr(argv));
throw new Error("execv failed");
`;

const setNoNewPrivileges = 38;
const getNoNewPrivileges = 39;
const setMDWE = 65;
const EPERM = 1;
const ENOSYS = 38;
const succeedsWithoutEffect = 0;

const refusal = (what: string) =>
  `error: can't run this executable's compiled code: ${what}, and this build of Bun doesn't run without it\n`;
const denyingMemory = "prctl(PR_SET_MDWE), which Linux has since 6.3,";

describe.skipIf(!isHardened)("an executable of a hardened build", () => {
  let directory: ReturnType<typeof tempDir>;
  let executable: string;
  let alone: Awaited<ReturnType<typeof run>>;

  beforeAll(async () => {
    directory = tempDir("aot-hardened-start", { "program.ts": program, "launcher.ts": launcher });
    executable = join(String(directory), "program");
    const source = join(String(directory), "program.ts");
    const built = await run([bunExe(), "build", "--compile", "--aot", source, "--outfile", executable]);
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
    alone = await run([executable]);
  }, 120_000);

  const under = (answers: { call: "prctl" | "seccomp"; request?: number; errno: number }[]) =>
    run([bunExe(), join(String(directory), "launcher.ts"), executable, JSON.stringify(answers)]);

  test("runs with no new privileges and a filter, or says that the kernel can't deny it executable memory", () => {
    if (alone.exitCode === 0)
      expect(alone).toEqual({ stdout: '{"noNewPrivileges":1,"seccompMode":2}\n', stderr: "", exitCode: 0 });
    else expect(alone).toEqual({ stdout: "", stderr: refusal(`${denyingMemory} failed with EINVAL`), exitCode: 1 });
  });

  test("exits before the program runs when it may still gain privileges", async () => {
    expect(
      await under([
        { call: "prctl", request: setNoNewPrivileges, errno: EPERM },
        { call: "prctl", request: getNoNewPrivileges, errno: succeedsWithoutEffect },
      ]),
    ).toEqual({ stdout: "", stderr: refusal("prctl(PR_SET_NO_NEW_PRIVS) failed with EPERM"), exitCode: 1 });
    expect(
      await under([
        { call: "prctl", request: setNoNewPrivileges, errno: succeedsWithoutEffect },
        { call: "prctl", request: getNoNewPrivileges, errno: succeedsWithoutEffect },
      ]),
    ).toEqual({ stdout: "", stderr: refusal("prctl(PR_SET_NO_NEW_PRIVS) succeeded and is not in force"), exitCode: 1 });
  });

  test("exits before the program runs when the kernel doesn't deny it executable memory", async () => {
    expect(await under([{ call: "prctl", request: setMDWE, errno: EPERM }])).toEqual({
      stdout: "",
      stderr: refusal(`${denyingMemory} failed with EPERM`),
      exitCode: 1,
    });
    expect(await under([{ call: "prctl", request: setMDWE, errno: succeedsWithoutEffect }])).toEqual({
      stdout: "",
      stderr: refusal(`${denyingMemory} succeeded and is not in force`),
      exitCode: 1,
    });
  });

  test("exits before the program runs when its filter is refused", async () => {
    if (alone.exitCode !== 0) return;
    expect(await under([{ call: "seccomp", errno: ENOSYS }])).toEqual({
      stdout: "",
      stderr: refusal("seccomp(SECCOMP_SET_MODE_FILTER) failed with ENOSYS"),
      exitCode: 1,
    });
  });
});
