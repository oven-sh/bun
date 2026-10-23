import { expect } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { join } from "node:path";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

const program = `class Point {
  constructor(public x: number, public y: number) {}
  length(): number { return Math.sqrt(this.x * this.x + this.y * this.y); }
}
const points: Point[] = [];
for (let i = 0; i < 1000; i++) points.push(new Point(i, i + 1));
let sum = 0;
for (const point of points) sum += point.length();
async function later(n: number): Promise<number> { await null; return n * 2; }
const pattern = new RegExp("^" + "ab".slice(0, 1) + "+$");
const add = new Function("a", "b", "return a + b");
try { (null as any).x; } catch (error) { console.log((error as Error).constructor.name); }
console.log(sum.toFixed(3), pattern.test("aaa"), add(20, 22), JSON.stringify({ a: [1, { b: "c" }] }), await later(21));
`;

const launcher = `import { dlopen, FFIType, ptr } from "bun:ffi";
const libc = dlopen("libc.so.6", {
  prctl: { args: [FFIType.i32, FFIType.u64, FFIType.u64, FFIType.u64, FFIType.u64], returns: FFIType.i32 },
  execve: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
});
const load = 0x20, jumpIfEqual = 0x15, jumpIfAnyBitSet = 0x45, answer = 0x06;
const allow = 0x7fff0000, killProcess = 0x80000000;
const systemCall = 0, architecture = 4, protection = 32, flags = 40;
const instructions = [
  [load, 0, 0, architecture], [jumpIfEqual, 1, 0, 0xc000003e], [answer, 0, 0, allow],
  [load, 0, 0, systemCall],
  [jumpIfEqual, 0, 5, 9],
  [load, 0, 0, protection], [jumpIfAnyBitSet, 0, 8, 4],
  [load, 0, 0, flags], [jumpIfAnyBitSet, 0, 6, 0x20], [answer, 0, 0, killProcess],
  [jumpIfEqual, 1, 0, 10], [jumpIfEqual, 0, 3, 329],
  [load, 0, 0, protection], [jumpIfAnyBitSet, 0, 1, 4], [answer, 0, 0, killProcess],
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
const path = Buffer.from(process.argv[2] + "\\0");
const argv = new BigUint64Array([BigInt(ptr(path)), 0n]);
const variables = Object.entries({ ...process.env, BUN_JSC_crashIfInterpreterIsUsed: "1" }).map(([name, value]) => Buffer.from(name + "=" + value + "\\0"));
const environment = new BigUint64Array([...variables.map(variable => BigInt(ptr(variable))), 0n]);
const setNoNewPrivileges = 38, setSeccomp = 22, filterMode = 2;
if (libc.symbols.prctl(setNoNewPrivileges, 1, 0, 0, 0)) throw new Error("PR_SET_NO_NEW_PRIVS was refused");
if (libc.symbols.prctl(setSeccomp, filterMode, ptr(filterProgram), 0, 0)) throw new Error("the filter was refused");
libc.symbols.execve(ptr(path), ptr(argv), ptr(environment));
throw new Error("execve failed");
`;

test.skipIf(!isLinux || process.arch !== "x64")(
  "an executable runs where asking for anonymous executable memory, or for memory to become executable, kills the process",
  async () => {
    using dir = tempDir("aot-no-executable-memory", { "program.ts": program, "launcher.ts": launcher });
    const executable = join(String(dir), "program");
    const { stderr: buildErrors, exitCode: buildExitCode } = await runCommand([
      bunExe(),
      "build",
      "--compile",
      "--aot",
      join(String(dir), "program.ts"),
      "--outfile",
      executable,
    ]);
    expect({ buildErrors, buildExitCode }).toEqual({ buildErrors: expect.any(String), buildExitCode: 0 });

    const run = async (cmd: string[], env: Record<string, string | undefined>) => {
      await using proc = Bun.spawn({ cmd, env, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode, signalCode: proc.signalCode };
    };
    const free = await run([executable], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
    expect(free).toEqual({
      stdout: 'TypeError\n707108.284 true 42 {"a":[1,{"b":"c"}]} 42\n',
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
    expect(await run([bunExe(), join(String(dir), "launcher.ts"), executable], bunEnv)).toEqual(free);
  },
  120_000,
);
