import { expect } from "bun:test";
import { bunEnv, bunExe, isGlibc, isLinux, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "./supported";

// oven-sh/bun#47177: an executable from `bun build --compile --aot` did not start on AWS Lambda (128 MB, a seccomp filter).
// Both tests need Linux: the first reads how the loader reserves the lowest pages, the second reads the flags of the process's mappings.

// Null checks and loop polls, so that the image has fault sites and the loader reserves the lowest pages.
const program = `function sum(items: { n: number }[]) {
  let total = 0;
  for (let i = 0; i < items.length; i++) total += items[i].n;
  return total;
}
const list = Array.from({ length: 1000 }, (_, n) => ({ n }));
let acc = 0;
for (let k = 0; k < 200; k++) acc += sum(list);
console.log("sum", acc);
`;

// Runs the executable named by argv[2] as AWS Lambda runs it: mincore(2) fails with EPERM. CAP_SYS_RAWIO leaves the bounding set
// first, so that a test run by root cannot map a page below vm.mmap_min_addr either, and the loader has to know whether one is mapped.
const launcher = `import { dlopen, FFIType, ptr } from "bun:ffi";
const libc = dlopen("libc.so.6", {
  prctl: { args: [FFIType.i32, FFIType.u64, FFIType.u64, FFIType.u64, FFIType.u64], returns: FFIType.i32 },
  execv: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
});
const load = 0x20, jumpIfEqual = 0x15, answer = 0x06;
const allow = 0x7fff0000, permissionDenied = 0x00050000 | 1;
const systemCall = 0, architecture = 4;
const [thisArchitecture, mincore] = process.arch === "arm64" ? [0xc00000b7, 232] : [0xc000003e, 27];
const instructions = [
  [load, 0, 0, architecture], [jumpIfEqual, 1, 0, thisArchitecture], [answer, 0, 0, allow],
  [load, 0, 0, systemCall], [jumpIfEqual, 0, 1, mincore], [answer, 0, 0, permissionDenied],
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
const dropFromBoundingSet = 24, capabilityRawIO = 17, setNoNewPrivileges = 38, setSeccomp = 22, filterMode = 2;
libc.symbols.prctl(dropFromBoundingSet, capabilityRawIO, 0, 0, 0);
if (libc.symbols.prctl(setNoNewPrivileges, 1, 0, 0, 0)) throw new Error("PR_SET_NO_NEW_PRIVS was refused");
if (libc.symbols.prctl(setSeccomp, filterMode, ptr(filterProgram), 0, 0)) throw new Error("the filter was refused");
libc.symbols.execv(ptr(path), ptr(argv));
throw new Error("execv failed");
`;

// Prints every private writable mapping of 128 MB or more: its size in MB and its VmFlags.
const mappings = `import { readFileSync } from "node:fs";
let range = "", permissions = "";
for (const line of readFileSync("/proc/self/smaps", "utf8").split("\\n")) {
  const header = /^([0-9a-f]+)-([0-9a-f]+) (\\S+)/.exec(line);
  if (header) {
    range = header[1] + "-" + header[2];
    permissions = header[3];
    continue;
  }
  if (!line.startsWith("VmFlags:") || permissions !== "rw-p") continue;
  const [start, end] = range.split("-").map(hex => parseInt(hex, 16));
  const megabytes = (end - start) / 2 ** 20;
  if (megabytes >= 128) console.log(megabytes + " " + line.slice("VmFlags:".length).trim());
}
`;

async function run(cmd: string[], cwd: string) {
  await using proc = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

async function build(dir: string, source: string) {
  const executable = join(dir, "program");
  const built = await run([bunExe(), "build", "--compile", "--aot", source, "--outfile", executable], dir);
  expect({ stderr: built.stderr.split("\n").filter(line => line.startsWith("error")), exitCode: built.exitCode }).toEqual({
    stderr: [],
    exitCode: 0,
  });
  return executable;
}

function lowestAddressTheSystemMaps(): number {
  try {
    return Number(readFileSync("/proc/sys/vm/mmap_min_addr", "utf8"));
  } catch {
    return 0;
  }
}

// Where the lowest 16 KB may be mapped the loader reserves them, one page at a time. A page below vm.mmap_min_addr is refused to it,
// and it has to know that the page is unmapped. It used to ask mincore, and read a refusal as "mapped".
test.skipIf(!isLinux || !isGlibc || lowestAddressTheSystemMaps() >= 16384)(
  "compiled code starts where a seccomp filter refuses mincore",
  async () => {
    using dir = tempDir("aot-start-without-mincore", { "program.ts": program, "launcher.ts": launcher });
    const executable = await build(String(dir), "program.ts");
    const ran = await run([bunExe(), join(String(dir), "launcher.ts"), executable], String(dir));
    expect({ stdout: ran.stdout, stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({
      stdout: "sum 99900000\n",
      stderr: "",
      exitCode: 0,
    });
  },
  120_000,
);

// The tables of the property caches are reserved at their greatest size (256 MB for the table of structure rows) and touched as
// they fill. The system must not count a whole table as committed memory: a machine with less memory than that refuses the
// mapping, and the program aborts at start. MAP_NORESERVE shows as "nr" among the VmFlags of /proc/self/smaps.
test.skipIf(!isLinux)(
  "no table of compiled code is counted as committed memory before it is written",
  async () => {
    using dir = tempDir("aot-tables-not-counted", { "program.ts": program + mappings });
    const executable = await build(String(dir), "program.ts");
    const ran = await run([executable], String(dir));
    expect({ stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const [sum, ...large] = ran.stdout.trim().split("\n");
    expect(sum).toBe("sum 99900000");
    const countedBeforeWritten = large.filter(mapping => !mapping.split(" ").includes("nr"));
    expect({ large: large.length > 0, countedBeforeWritten }).toEqual({ large: true, countedBeforeWritten: [] });
  },
  120_000,
);
