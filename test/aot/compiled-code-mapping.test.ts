import { expect } from "bun:test";
import { test } from "./supported";
import { bunEnv, bunExe, isGlibc, isLinux, readElf64ProgramHeaders, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findImage, imageHeader } from "./cli/compiled-image";

const program = `import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
class Point {
  constructor(public x: number, public y: number) {}
  length(): number { return Math.sqrt(this.x * this.x + this.y * this.y); }
}
const server = createServer((request, response) => response.end(String(new Point(3, 4).length())));
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
console.log(await (await fetch("http://127.0.0.1:" + (server.address() as AddressInfo).port)).text());
server.close();
console.log(readFileSync("/proc/self/maps", "utf8"));
`;

const seccompLauncher = `import { dlopen, FFIType, ptr } from "bun:ffi";
const libc = dlopen("libc.so.6", {
  prctl: { args: [FFIType.i32, FFIType.u64, FFIType.u64, FFIType.u64, FFIType.u64], returns: FFIType.i32 },
  execv: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
});
const load = 0x20, jumpIfEqual = 0x15, jumpIfAnyBitSet = 0x45, answer = 0x06;
const allow = 0x7fff0000, permissionDenied = 0x00050000 | 13;
const systemCall = 0, architecture = 4, protection = 32, flags = 40, executable = 4, denyWrite = 0x800;
const [thisArchitecture, mmap, mprotect, pkeyMprotect] = process.arch === "arm64" ? [0xc00000b7, 222, 226, 288] : [0xc000003e, 9, 10, 329];
const instructions = [
  [load, 0, 0, architecture], [jumpIfEqual, 1, 0, thisArchitecture], [answer, 0, 0, allow],
  [load, 0, 0, systemCall],
  [jumpIfEqual, 0, 5, mmap],
  [load, 0, 0, protection], [jumpIfAnyBitSet, 0, 8, executable],
  [load, 0, 0, flags], [jumpIfAnyBitSet, 6, 0, denyWrite], [answer, 0, 0, permissionDenied],
  [jumpIfEqual, 1, 0, mprotect], [jumpIfEqual, 0, 3, pkeyMprotect],
  [load, 0, 0, protection], [jumpIfAnyBitSet, 0, 1, executable], [answer, 0, 0, permissionDenied],
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
const setNoNewPrivileges = 38, setSeccomp = 22, filterMode = 2;
if (libc.symbols.prctl(setNoNewPrivileges, 1, 0, 0, 0)) throw new Error("PR_SET_NO_NEW_PRIVS was refused");
if (libc.symbols.prctl(setSeccomp, filterMode, ptr(filterProgram), 0, 0)) throw new Error("the filter was refused");
libc.symbols.execv(ptr(path), ptr(argv));
throw new Error("execv failed");
`;

const loadable = 1;
const [mayExecute, mayWrite, mayRead] = [1, 2, 4];

function loadSegments(path: string) {
  return readElf64ProgramHeaders(path)
    .filter(header => header.type === loadable)
    .map(header => ({ flags: header.flags, start: Number(header.offset), end: Number(header.offset + header.filesz) }));
}

async function run(cmd: string[]) {
  await using proc = Bun.spawn({ cmd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signalCode: proc.signalCode };
}

async function build(directory: string) {
  const executable = join(directory, "program");
  const built = await run([bunExe(), "build", "--compile", "--aot", join(directory, "program.ts"), "--outfile", executable]);
  expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
  return executable;
}

function mappingsOf(output: string) {
  return output
    .split("\n")
    .map(line => line.split(/\s+/))
    .filter(words => /^[0-9a-f]+-[0-9a-f]+$/.test(words[0]))
    .map(([addresses, access, offset, , , path = ""]) => ({ start: parseInt(addresses, 16), access, offset: parseInt(offset, 16), path }));
}

test.skipIf(!isLinux)("executable pages are file-backed and never writable", async () => {
  using dir = tempDir("aot-code-mapping", { "program.ts": program });
  const executable = await build(String(dir));
  const file = readFileSync(executable);
  const codeOffset = findImage(file) + Number(file.readBigUInt64LE(findImage(file) + imageHeader.codeOffset));

  const { stdout, exitCode } = await run([executable]);
  expect({ firstLine: stdout.split("\n")[0], exitCode }).toEqual({ firstLine: "5", exitCode: 0 });
  const executableMappings = mappingsOf(stdout).filter(mapping => mapping.access.includes("x"));
  expect(executableMappings.filter(mapping => mapping.access.includes("w"))).toEqual([]);
  expect(executableMappings.filter(mapping => !mapping.path.startsWith("/") && !mapping.path.startsWith("[v"))).toEqual([]);
  expect(executableMappings.filter(mapping => mapping.path === executable && mapping.offset === codeOffset)).toEqual([
    { start: expect.any(Number), access: "r-xp", offset: codeOffset, path: executable },
  ]);
}, 120_000);

test.skipIf(!isLinux)("the address of compiled code is independent of the executable and of libc", async () => {
  using dir = tempDir("aot-code-mapping-address", { "program.ts": program });
  const executable = await build(String(dir));
  const file = readFileSync(executable);
  const codeOffset = findImage(file) + Number(file.readBigUInt64LE(findImage(file) + imageHeader.codeOffset));

  const distances = await Promise.all(
    Array.from({ length: 4 }, async () => {
      const mappings = mappingsOf((await run([executable])).stdout);
      const code = mappings.find(mapping => mapping.access === "r-xp" && mapping.path === executable && mapping.offset === codeOffset)!.start;
      const startOf = (isWanted: (path: string) => boolean) => mappings.find(mapping => isWanted(mapping.path) && !mapping.offset)!.start;
      return { toExecutable: code - startOf(path => path === executable), toLibrary: code - startOf(path => /\/(libc|ld-)[^/]*$/.test(path)) };
    }),
  );
  expect(new Set(distances.map(distance => distance.toExecutable)).size).toBe(distances.length);
  expect(new Set(distances.map(distance => distance.toLibrary)).size).toBe(distances.length);
}, 120_000);

test.skipIf(!isLinux)("compiled code has its own read-execute segment and the rest of the payload is read-only", async () => {
  using dir = tempDir("aot-code-mapping-segment", { "program.ts": program });
  const executable = await build(String(dir));
  const file = readFileSync(executable);
  const image = findImage(file);
  const code = image + Number(file.readBigUInt64LE(image + imageHeader.codeOffset));
  const end = image + Number(file.readBigUInt64LE(image + imageHeader.size));

  const segments = loadSegments(executable);
  expect(segments.filter(segment => segment.flags & mayWrite && segment.flags & mayExecute)).toEqual([]);
  expect(segments.find(segment => segment.start <= image && image < segment.end)).toEqual({ flags: mayRead, start: expect.any(Number), end: code });
  expect(segments.find(segment => segment.start <= code && code < segment.end)).toEqual({ flags: mayRead | mayExecute, start: code, end });
  expect(segments.filter(segment => segment.start >= end).map(segment => segment.flags)).toEqual([mayRead]);
}, 120_000);

test.skipIf(!isLinux)("Bun has room for the program headers of an executable", async () => {
  const [note, descriptorSizeOffset, noteHeaderBytes] = [4, 4, 16];
  const rooms = readElf64ProgramHeaders(bunExe()).filter(header => header.type === note && header.align === 8n);
  expect(rooms.map(room => room.filesz)).toEqual([3600n]);
  const offset = Number(rooms[0].offset);
  const header = new DataView(await Bun.file(bunExe()).slice(offset, offset + noteHeaderBytes).arrayBuffer());
  expect(header.getUint32(descriptorSizeOffset, true)).toBe(3584);
  expect(offset + noteHeaderBytes).toBeLessThan(1024);
});

test.skipIf(!isLinux)("zero-initialized data of the runtime takes no bytes of the file", async () => {
  using dir = tempDir("aot-code-mapping-zeros", { "program.ts": program });
  const sizesOf = (path: string) =>
    readElf64ProgramHeaders(path)
      .filter(header => header.type === loadable && header.memsz > header.filesz)
      .map(header => ({ filesz: header.filesz, memsz: header.memsz }));
  expect(sizesOf(bunExe())).not.toEqual([]);
  expect(sizesOf(await build(String(dir)))).toEqual(sizesOf(bunExe()));
}, 120_000);

test.skipIf(!isLinux || !isGlibc)("falls back to the segment the loader mapped when mmap with PROT_EXEC is refused", async () => {
  using dir = tempDir("aot-code-mapping-refused", { "program.ts": program, "launcher.ts": seccompLauncher });
  const executable = await build(String(dir));
  const { stdout, stderr, exitCode, signalCode } = await run([bunExe(), join(String(dir), "launcher.ts"), executable]);
  expect({ firstLine: stdout.split("\n")[0], stderr, exitCode, signalCode }).toEqual({ firstLine: "5", stderr: "", exitCode: 0, signalCode: null });
}, 120_000);

test.skipIf(!isLinux || !Bun.which("setarch"))("with ASLR disabled, compiled code runs from the segment the loader mapped", async () => {
  using dir = tempDir("aot-code-mapping-no-aslr", { "program.ts": program });
  const executable = await build(String(dir));
  const file = readFileSync(executable);
  const codeOffset = findImage(file) + Number(file.readBigUInt64LE(findImage(file) + imageHeader.codeOffset));
  const starts = await Promise.all(
    Array.from({ length: 2 }, async () => {
      const mappings = mappingsOf((await run(["setarch", process.arch === "arm64" ? "aarch64" : "x86_64", "-R", executable])).stdout).filter(mapping => mapping.path === executable);
      return { code: mappings.find(mapping => mapping.offset === codeOffset), count: mappings.filter(mapping => mapping.offset === codeOffset).length, first: mappings[0].start };
    }),
  );
  expect(starts[0]).toEqual({ code: { start: expect.any(Number), access: "r-xp", offset: codeOffset, path: executable }, count: 1, first: expect.any(Number) });
  expect(starts[1]).toEqual(starts[0]);
}, 120_000);

test.skipIf(!isLinux)("the process writes to no page of the image", async () => {
  using dir = tempDir("aot-code-mapping-clean", { "program.ts": program.replace("/proc/self/maps", "/proc/self/smaps") });
  const executable = await build(String(dir));
  const file = readFileSync(executable);
  const image = findImage(file);
  const end = image + Number(file.readBigUInt64LE(image + imageHeader.size));

  const { stdout, exitCode } = await run([executable]);
  expect(exitCode).toBe(0);
  const mappings = stdout.split(/\n(?=[0-9a-f]+-[0-9a-f]+ )/).map(text => {
    const [addresses, , offset, , , path = ""] = text.split("\n")[0].split(/\s+/);
    const [from, to] = addresses.split("-").map(address => parseInt(address, 16));
    return { path, start: parseInt(offset, 16), end: parseInt(offset, 16) + to - from, written: Number(/^Anonymous:\s+(\d+)/m.exec(text)?.[1]) };
  });
  const ofImage = mappings.filter(mapping => mapping.path === executable && mapping.start < end && mapping.end > image);
  expect(ofImage.reduce((size, mapping) => size + mapping.end - mapping.start, 0)).toBeGreaterThanOrEqual(end - image);
  expect(ofImage.filter(mapping => mapping.written)).toEqual([]);
}, 120_000);

const llvmStrip = Bun.which("llvm-strip");

test.skipIf(!isLinux || !llvmStrip)("llvm-strip leaves one copy of the payload", async () => {
  using dir = tempDir("aot-code-mapping-strip", { "program.ts": program });
  const executable = await build(String(dir));
  const stripped = executable + "-stripped";
  expect((await run([llvmStrip!, "-o", stripped, executable])).exitCode).toBe(0);
  const [before, after] = [readFileSync(executable), readFileSync(stripped)];
  const header = before.subarray(findImage(before), findImage(before) + imageHeader.prefixSize);
  expect(after.indexOf(header)).toBeGreaterThan(0);
  expect(after.indexOf(header)).toBe(after.lastIndexOf(header));
  const { stdout, exitCode } = await run([stripped]);
  expect({ firstLine: stdout.split("\n")[0], exitCode }).toEqual({ firstLine: "5", exitCode: 0 });
}, 120_000);

const withoutProc = ["unshare", "--user", "--map-root-user", "--mount", "sh", "-c", 'mount -t tmpfs none /proc && exec "$0"'];
const canUnmountProc = isLinux && Bun.spawnSync({ cmd: [...withoutProc, "true"], stdout: "ignore", stderr: "ignore" }).exitCode === 0;

test.skipIf(!canUnmountProc)("runs without /proc", async () => {
  using dir = tempDir("aot-code-mapping-no-proc", { "program.ts": `console.log(require("node:fs").existsSync("/proc/self/exe"), [3, 4].map(x => x * x).join());` });
  expect(await run([...withoutProc, await build(String(dir))])).toEqual({ stdout: "false 9,16\n", stderr: "", exitCode: 0, signalCode: null });
}, 120_000);
