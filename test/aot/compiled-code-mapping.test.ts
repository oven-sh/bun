import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isGlibc, isLinux, readElf64ProgramHeaders, tempDir } from "harness";
import { chmodSync, readFileSync } from "node:fs";
import { release } from "node:os";
import { join } from "node:path";
import { findImage, imageHeader } from "./cli/compiled-image";
import { refusesExecuteOnlyStart } from "./execute-only-start";
import { test } from "./supported";

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
const [thisArchitecture, mmap, mprotect, pkeyMprotect, mremap] = process.arch === "arm64" ? [0xc00000b7, 222, 226, 288, 216] : [0xc000003e, 9, 10, 329, 25];
const instructions = [
  [load, 0, 0, architecture], [jumpIfEqual, 1, 0, thisArchitecture], [answer, 0, 0, allow],
  [load, 0, 0, systemCall],
  ...(process.argv[3] === "refuse-mremap" ? [[jumpIfEqual, 0, 1, mremap], [answer, 0, 0, permissionDenied]] : []),
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
  const built = await run([
    bunExe(),
    "build",
    "--compile",
    "--aot",
    join(directory, "program.ts"),
    "--outfile",
    executable,
  ]);
  expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
  return executable;
}

function mappingsOf(output: string) {
  return output
    .split("\n")
    .map(line => line.split(/\s+/))
    .filter(words => /^[0-9a-f]+-[0-9a-f]+$/.test(words[0]))
    .map(([addresses, access, offset, , , path = ""]) => ({
      start: parseInt(addresses, 16),
      access,
      offset: parseInt(offset, 16),
      path,
    }));
}

test.skipIf(!isLinux)(
  "executable pages are file-backed and never writable",
  async () => {
    using dir = tempDir("aot-code-mapping", { "program.ts": program });
    const executable = await build(String(dir));
    const file = readFileSync(executable);
    const codeOffset = findImage(file) + Number(file.readBigUInt64LE(findImage(file) + imageHeader.codeOffset));

    const { stdout, exitCode } = await run([executable]);
    expect({ firstLine: stdout.split("\n")[0], exitCode }).toEqual({ firstLine: "5", exitCode: 0 });
    const executableMappings = mappingsOf(stdout).filter(mapping => mapping.access.includes("x"));
    expect(executableMappings.filter(mapping => mapping.access.includes("w"))).toEqual([]);
    expect(
      executableMappings.filter(mapping => !mapping.path.startsWith("/") && !mapping.path.startsWith("[v")),
    ).toEqual([]);
    expect(executableMappings.filter(mapping => mapping.path === executable && mapping.offset === codeOffset)).toEqual([
      { start: expect.any(Number), access: "r-xp", offset: codeOffset, path: executable },
    ]);
  },
  120_000,
);

test.skipIf(!isLinux)(
  "the address of compiled code is independent of the executable and of libc",
  async () => {
    using dir = tempDir("aot-code-mapping-address", { "program.ts": program });
    const executable = await build(String(dir));
    const file = readFileSync(executable);
    const codeOffset = findImage(file) + Number(file.readBigUInt64LE(findImage(file) + imageHeader.codeOffset));

    const distances = await Promise.all(
      Array.from({ length: 4 }, async () => {
        const mappings = mappingsOf((await run([executable])).stdout);
        const code = mappings.find(
          mapping => mapping.access === "r-xp" && mapping.path === executable && mapping.offset === codeOffset,
        )!.start;
        const startOf = (isWanted: (path: string) => boolean) =>
          mappings.find(mapping => isWanted(mapping.path) && !mapping.offset)!.start;
        return {
          toExecutable: code - startOf(path => path === executable),
          toLibrary: code - startOf(path => /\/(libc|ld-)[^/]*$/.test(path)),
        };
      }),
    );
    expect(new Set(distances.map(distance => distance.toExecutable)).size).toBe(distances.length);
    expect(new Set(distances.map(distance => distance.toLibrary)).size).toBe(distances.length);
  },
  120_000,
);

test.skipIf(!isLinux)(
  "compiled code has its own read-execute segment and the rest of the payload is read-only",
  async () => {
    using dir = tempDir("aot-code-mapping-segment", { "program.ts": program });
    const executable = await build(String(dir));
    const file = readFileSync(executable);
    const image = findImage(file);
    const code = image + Number(file.readBigUInt64LE(image + imageHeader.codeOffset));
    const end = code + Number(file.readBigUInt64LE(image + imageHeader.executableSize));
    expect(end).toBeLessThan(image + Number(file.readBigUInt64LE(image + imageHeader.size)));

    const segments = loadSegments(executable);
    expect(segments.filter(segment => segment.flags & mayWrite && segment.flags & mayExecute)).toEqual([]);
    expect(segments.find(segment => segment.start <= image && image < segment.end)).toEqual({
      flags: mayRead,
      start: expect.any(Number),
      end: code,
    });
    expect(segments.find(segment => segment.start <= code && code < segment.end)).toEqual({
      flags: mayRead | mayExecute,
      start: code,
      end,
    });
    expect(segments.filter(segment => segment.start >= end).map(segment => segment.flags)).toEqual([mayRead]);
  },
  120_000,
);

const programWithTables = `import { readFileSync } from "node:fs";
function nameOf(digit: number): string {
  switch (digit) {
    case 0: return "zero";
    case 1: return "one";
    case 2: return "two";
    case 3: return "three";
    case 4: return "four";
    case 5: return "five";
    case 6: return "six";
    case 7: return "seven";
    case 8: return "eight";
    case 9: return "nine";
    default: return "many";
  }
}
const words = Array.from("3141592653", digit => nameOf(Number(digit)));
console.log(words.join(" ").replace(/[aeiou\\u00e0-\\u00ff\\u0430-\\u044f]+/g, "").length * 0.125);
console.log(readFileSync("/proc/self/maps", "utf8"));
`;

function rowsOfMap(path: string, kind: string) {
  return readFileSync(path, "utf8")
    .split("\n")
    .map(line => line.split("\t"))
    .filter(fields => fields[0] === kind);
}

async function buildWithMap(directory: string) {
  const executable = join(directory, "program");
  const map = join(directory, "map");
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", join(directory, "program.ts"), "--outfile", executable],
    env: { ...bunEnv, BUN_JSC_aotMapFilePath: map },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect({ stderr: await proc.stderr.text(), exitCode: await proc.exited }).toEqual({
    stderr: expect.any(String),
    exitCode: 0,
  });
  return { executable, map };
}

test.skipIf(!isLinux || process.arch !== "x64")(
  "what lies between two functions is breakpoints",
  async () => {
    using dir = tempDir("aot-code-mapping-padding", { "program.ts": programWithTables });
    const { executable, map } = await buildWithMap(String(dir));
    const file = readFileSync(executable);
    const image = findImage(file);
    const codeOffset = image + Number(file.readBigUInt64LE(image + imageHeader.codeOffset));
    const pieces = [
      ...rowsOfMap(map, "F").map(fields => ({ start: Number(fields[2]), size: Number(fields[3]) })),
      ...rowsOfMap(map, "U").map(fields => ({ start: Number(fields[1]), size: Number(fields[2]) })),
    ].sort((a, b) => a.start - b.start);
    expect(pieces.length).toBeGreaterThan(100);
    const paddingBytes = new Set<number>();
    let numberOfGaps = 0;
    let end = pieces[0].start;
    for (const piece of pieces) {
      // Shared code lies between functions too, in runs of whole kilobytes.
      if (piece.start > end && piece.start - end < 16) {
        numberOfGaps++;
        for (const byte of file.subarray(codeOffset + end, codeOffset + piece.start)) paddingBytes.add(byte);
      }
      end = Math.max(end, piece.start + piece.size);
    }
    expect(numberOfGaps).toBeGreaterThan(10);
    expect([...paddingBytes]).toEqual([0xcc]);
  },
  120_000,
);

test.skipIf(!isLinux)(
  "a throw that names nothing has no data behind its call",
  async () => {
    using dir = tempDir("aot-code-mapping-throw", {
      "program.ts": `function total(lists: number[][] | null, index: number): number {
  let sum = 0;
  for (const value of lists![index]) sum += value;
  return sum;
}
for (const lists of [[[1, 2], [3]], null, [[4]]]) {
  try {
    console.log(total(lists, 0), Math.max(...lists![1]));
  } catch (error) {
    console.log((error as Error).constructor.name);
  }
}
`,
    });
    const { executable, map } = await buildWithMap(String(dir));
    expect(await run([executable])).toEqual({
      stdout: "3 3\nTypeError\nTypeError\n",
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
    const stubs = rowsOfMap(map, "T").map(fields => fields.at(-1)!);
    expect(stubs.filter(name => name.startsWith("ThrowAtSite.WordInRegister"))).not.toEqual([]);
    expect(stubs.filter(name => name.startsWith("ThrowAtSite.WordsAfterCall"))).toEqual([]);
  },
  120_000,
);

test.skipIf(!isLinux)(
  "a throw names a text that is one of the last of very many",
  async () => {
    using dir = tempDir("aot-code-mapping-late-names", {
      "program.ts": `const names: string[] = [${Array.from({ length: 140_000 }, (_, index) => `"n${index}"`).join(",\n")}];
function read(o: { lastNameOfAll: number } | null): number { return o!.lastNameOfAll; }
function store(o: { lastStoreOfAll: number } | undefined): void { o!.lastStoreOfAll = 1; }
function call(o: { lastMethodOfAll?: () => number }): number { return o.lastMethodOfAll!(); }
function early(): number { const get = () => lastBindingOfAll; const value = get(); let lastBindingOfAll = 1; return value + lastBindingOfAll; }
for (const f of [() => read(null), () => store(undefined), () => call({}), early]) {
  try {
    console.log(f());
  } catch (error) {
    console.log(/last[A-Za-z]+/.exec((error as Error).message)![0]);
  }
}
console.log(names.length, names.at(-1));
`,
    });
    const { executable, map } = await buildWithMap(String(dir));
    expect(await run([executable])).toEqual({
      stdout: "lastNameOfAll\nlastStoreOfAll\nlastMethodOfAll\nlastBindingOfAll\n140000 n139999\n",
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
    expect(rowsOfMap(map, "T").filter(fields => fields.at(-1) === "ThrowAtSite.WordsAfterCall").length).toBe(1);
  },
  120_000,
);

test.skipIf(!isLinux)(
  "the constants and jump tables of compiled code lie behind it, in pages that cannot be executed",
  async () => {
    using dir = tempDir("aot-code-mapping-data", { "program.ts": programWithTables });
    const { executable, map } = await buildWithMap(String(dir));
    const file = readFileSync(executable);
    const image = findImage(file);
    const codeOffset = image + Number(file.readBigUInt64LE(image + imageHeader.codeOffset));
    const executableSize = Number(file.readBigUInt64LE(image + imageHeader.executableSize));
    const dataSize = image + Number(file.readBigUInt64LE(image + imageHeader.size)) - codeOffset - executableSize;

    const constants = rowsOfMap(map, "K").map(([, offset, size]) => ({ offset: Number(offset), size: Number(size) }));
    expect(constants).toEqual([{ offset: expect.any(Number), size: expect.any(Number) }]);
    expect(constants[0].size).toBeGreaterThan(0);
    expect(constants[0].offset).toBeGreaterThanOrEqual(executableSize);
    expect(constants[0].offset + constants[0].size).toBeLessThanOrEqual(executableSize + dataSize);
    for (const kind of ["F", "U", "X", "XR"]) {
      const [offsetField, sizeField] = kind === "F" ? [2, 3] : [1, 2];
      const ends = rowsOfMap(map, kind).map(fields => Number(fields[offsetField]) + Number(fields[sizeField]));
      expect({ kind, isExecutable: ends.every(end => end <= executableSize) }).toEqual({ kind, isExecutable: true });
    }

    const roads: string[][] = [[executable]];
    if (Bun.which("setarch"))
      roads.push(["setarch", process.arch === "arm64" ? "aarch64" : "x86_64", "-R", executable]);
    for (const cmd of roads) {
      const { stdout, exitCode } = await run(cmd);
      expect({ firstLine: stdout.split("\n")[0], exitCode }).toEqual({ firstLine: "3.625", exitCode: 0 });
      const mappings = mappingsOf(stdout).filter(mapping => mapping.path === executable);
      const code = mappings.find(mapping => mapping.offset === codeOffset && mapping.access === "r-xp")!;
      expect(mappings.filter(mapping => mapping.start === code.start + executableSize)).toEqual([
        { start: code.start + executableSize, access: "r--p", offset: codeOffset + executableSize, path: executable },
      ]);
      expect(mappings.filter(mapping => mapping.access.includes("x") && mapping.offset > codeOffset)).toEqual([]);
    }
  },
  120_000,
);

test.skipIf(!isLinux || !isGlibc)(
  "the offsets of the stubs that native functions are called through lie behind the code, in pages that cannot be executed",
  async () => {
    using dir = tempDir("aot-code-mapping-ffi", {
      "program.ts": `import { dlopen, FFIType, JSCallback, ptr } from "bun:ffi";
const libc = dlopen("libc.so.6", {
  abs: { args: [FFIType.i32], returns: FFIType.i32 },
  qsort: { args: [FFIType.ptr, FFIType.u64, FFIType.u64, FFIType.function], returns: FFIType.void },
});
let calls = 0;
const compare = new JSCallback(() => (calls++, 0), { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 });
libc.symbols.qsort(ptr(new Int32Array([3, 1, 2])), 3, 4, compare.ptr);
console.log(libc.symbols.abs(-5), calls > 0);
`,
    });
    const { executable, map } = await buildWithMap(String(dir));
    expect(await run([executable])).toEqual({ stdout: "5 true\n", stderr: "", exitCode: 0, signalCode: null });

    const file = readFileSync(executable);
    const image = findImage(file);
    const codeOffset = image + Number(file.readBigUInt64LE(image + imageHeader.codeOffset));
    const codeSize = Number(file.readBigUInt64LE(image + imageHeader.codeSize));
    const executableSize = Number(file.readBigUInt64LE(image + imageHeader.executableSize));
    const endOfConstants =
      file.readUInt32LE(image + imageHeader.constantsOffset) + file.readUInt32LE(image + imageHeader.constantsSize);
    const stubs = rowsOfMap(map, "N").map(([, offset, size]) => ({ offset: Number(offset), size: Number(size) }));
    expect(stubs).toEqual([{ offset: expect.any(Number), size: expect.any(Number) }]);
    expect(stubs[0].offset + stubs[0].size).toBeLessThanOrEqual(executableSize);

    const start = Math.ceil(endOfConstants / 4) * 4;
    expect(start).toBeGreaterThanOrEqual(executableSize);
    const [invoke, context, contextSize, numberOfEntries, ...entries] = Array.from(
      { length: (codeSize - start) / 4 },
      (_, index) => file.readUInt32LE(codeOffset + start + index * 4),
    );
    expect({ end: context + contextSize, numberOfEntries }).toEqual({
      end: stubs[0].size,
      numberOfEntries: entries.length,
    });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries).toEqual([...new Set(entries)].sort((a, b) => a - b));
    expect([invoke, ...entries].filter(offset => offset >= context)).toEqual([]);
    expect(
      loadSegments(executable)
        .filter(segment => segment.start <= codeOffset + start && codeOffset + codeSize <= segment.end)
        .map(segment => segment.flags),
    ).toEqual([mayRead]);
  },
  120_000,
);

test.skipIf(!isLinux)("Bun has room for the program headers of an executable", async () => {
  const [note, descriptorSizeOffset, noteHeaderBytes] = [4, 4, 16];
  const rooms = readElf64ProgramHeaders(bunExe()).filter(header => header.type === note && header.align === 8n);
  expect(rooms.map(room => room.filesz)).toEqual([4104n]);
  const offset = Number(rooms[0].offset);
  const header = new DataView(
    await Bun.file(bunExe())
      .slice(offset, offset + noteHeaderBytes)
      .arrayBuffer(),
  );
  expect(header.getUint32(descriptorSizeOffset, true)).toBe(4088);
  expect(offset + noteHeaderBytes).toBeLessThan(1024);
});

test.skipIf(!isLinux)(
  "zero-initialized data of the runtime takes no bytes of the file",
  async () => {
    using dir = tempDir("aot-code-mapping-zeros", { "program.ts": program });
    const sizesOf = (path: string) =>
      readElf64ProgramHeaders(path)
        .filter(header => header.type === loadable && header.memsz > header.filesz)
        .map(header => ({ filesz: header.filesz, memsz: header.memsz }));
    expect(sizesOf(bunExe())).not.toEqual([]);
    expect(sizesOf(await build(String(dir)))).toEqual(sizesOf(bunExe()));
  },
  120_000,
);

const [kernelMajor, kernelMinor] = release().split(".").map(Number);
const canMoveFileMappings =
  isLinux && !refusesExecuteOnlyStart && (kernelMajor > 5 || (kernelMajor === 5 && kernelMinor >= 13));

async function placesOfCode(executable: string, codeOffset: number, cmd: string[]) {
  return await Promise.all(
    Array.from({ length: 4 }, async () => {
      const { stdout, stderr, exitCode, signalCode } = await run(cmd);
      expect({ firstLine: stdout.split("\n")[0], stderr, exitCode, signalCode }).toEqual({
        firstLine: "5",
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
      return mappingsOf(stdout).filter(mapping => mapping.path === executable && mapping.offset === codeOffset);
    }),
  );
}

const isLinkedAtFixedAddress = (file: Buffer) => file.readUInt16LE(16) === 2;

async function expectRefusalToRunAtFixedAddress(cmd: string[]) {
  const { stdout, stderr, exitCode, signalCode } = await run(cmd);
  expect({ stdout, exitCode, signalCode }).toEqual({ stdout: "", exitCode: 1, signalCode: null });
  expect(stderr).toContain("its code can't be placed at a random address here, and it doesn't run at a fixed one");
}

function expectCodeAtAnotherAddressEachTime(places: Awaited<ReturnType<typeof placesOfCode>>) {
  const executablePlaces = places.map(mappings => mappings.filter(mapping => mapping.access.includes("x")));
  expect(executablePlaces.map(mappings => mappings.map(mapping => mapping.access))).toEqual(places.map(() => ["r-xp"]));
  expect(new Set(executablePlaces.map(mappings => mappings[0].start)).size).toBe(places.length);
}

test.skipIf(!isLinux || !isGlibc)(
  "runs from the segment the loader mapped when mmap with PROT_EXEC is refused",
  async () => {
    using dir = tempDir("aot-code-mapping-refused", { "program.ts": program, "launcher.ts": seccompLauncher });
    const executable = await build(String(dir));
    const file = readFileSync(executable);
    const codeOffset = findImage(file) + Number(file.readBigUInt64LE(findImage(file) + imageHeader.codeOffset));
    const cmd = [bunExe(), join(String(dir), "launcher.ts"), executable];
    if (!canMoveFileMappings && isLinkedAtFixedAddress(file)) return await expectRefusalToRunAtFixedAddress(cmd);
    const places = await placesOfCode(executable, codeOffset, cmd);
    if (canMoveFileMappings) expectCodeAtAnotherAddressEachTime(places);
  },
  120_000,
);

test.skipIf(!isLinux || !isGlibc)(
  "refuses to start where its compiled code could only run at a fixed address",
  async () => {
    using dir = tempDir("aot-code-mapping-fixed", { "program.ts": program, "launcher.ts": seccompLauncher });
    const executable = await build(String(dir));
    const cmd = [bunExe(), join(String(dir), "launcher.ts"), executable, "refuse-mremap"];
    if (isLinkedAtFixedAddress(readFileSync(executable))) return await expectRefusalToRunAtFixedAddress(cmd);
    const { stdout, exitCode } = await run(cmd);
    expect({ firstLine: stdout.split("\n")[0], exitCode }).toEqual({ firstLine: "5", exitCode: 0 });
  },
  120_000,
);

test.skipIf(!isLinux || refusesExecuteOnlyStart)(
  "an executable that may be run but not read has its compiled code at another address each time",
  async () => {
    using dir = tempDir("aot-code-mapping-unreadable", { "program.ts": program });
    const executable = await build(String(dir));
    const file = readFileSync(executable);
    const codeOffset = findImage(file) + Number(file.readBigUInt64LE(findImage(file) + imageHeader.codeOffset));
    chmodSync(executable, 0o111);
    if (!canMoveFileMappings && isLinkedAtFixedAddress(file))
      return await expectRefusalToRunAtFixedAddress([executable]);
    const places = await placesOfCode(executable, codeOffset, [executable]);
    if (canMoveFileMappings) expectCodeAtAnotherAddressEachTime(places);
  },
  120_000,
);

test.skipIf(!isLinux)(
  "an executable that the dynamic loader is started with runs its own code, not bytes of the loader's file",
  async () => {
    using dir = tempDir("aot-code-mapping-by-the-loader", { "program.ts": program });
    const executable = await build(String(dir));
    const file = readFileSync(executable);
    const codeOffset = findImage(file) + Number(file.readBigUInt64LE(findImage(file) + imageHeader.codeOffset));
    const interpreter = readElf64ProgramHeaders(executable).find(header => header.type === 3)!;
    const end = Number(interpreter.offset + interpreter.filesz) - 1;
    const cmd = [file.toString("latin1", Number(interpreter.offset), end), executable];
    // glibc's loader leaves the name of the executable where the kernel put its own, so the executable finds its file.
    const first = await run(cmd);
    if (first.exitCode === 1) {
      expect({ stdout: first.stdout, signalCode: first.signalCode }).toEqual({ stdout: "", signalCode: null });
      if (refusesExecuteOnlyStart)
        expect(first.stderr).toContain("the executable's own file can't be opened for reading");
      else
        expect({ canMoveFileMappings, stderr: first.stderr }).toEqual({
          canMoveFileMappings: false,
          stderr: expect.stringContaining("it doesn't run at a fixed one"),
        });
      return;
    }
    expectCodeAtAnotherAddressEachTime(await placesOfCode(executable, codeOffset, cmd));
  },
  120_000,
);

test.skipIf(!isLinux || !Bun.which("setarch"))(
  "with ASLR disabled, compiled code runs from the segment the loader mapped",
  async () => {
    using dir = tempDir("aot-code-mapping-no-aslr", { "program.ts": program });
    const executable = await build(String(dir));
    const file = readFileSync(executable);
    const codeOffset = findImage(file) + Number(file.readBigUInt64LE(findImage(file) + imageHeader.codeOffset));
    const starts = await Promise.all(
      Array.from({ length: 2 }, async () => {
        const mappings = mappingsOf(
          (await run(["setarch", process.arch === "arm64" ? "aarch64" : "x86_64", "-R", executable])).stdout,
        ).filter(mapping => mapping.path === executable);
        return {
          code: mappings.find(mapping => mapping.offset === codeOffset),
          count: mappings.filter(mapping => mapping.offset === codeOffset).length,
          first: mappings[0].start,
        };
      }),
    );
    expect(starts[0]).toEqual({
      code: { start: expect.any(Number), access: "r-xp", offset: codeOffset, path: executable },
      count: 1,
      first: expect.any(Number),
    });
    expect(starts[1]).toEqual(starts[0]);
  },
  120_000,
);

test.skipIf(!isLinux)(
  "the process writes to no page of the image",
  async () => {
    using dir = tempDir("aot-code-mapping-clean", {
      "program.ts": program.replace("/proc/self/maps", "/proc/self/smaps"),
    });
    const executable = await build(String(dir));
    const file = readFileSync(executable);
    const image = findImage(file);
    const end = image + Number(file.readBigUInt64LE(image + imageHeader.size));

    const { stdout, exitCode } = await run([executable]);
    expect(exitCode).toBe(0);
    const mappings = stdout.split(/\n(?=[0-9a-f]+-[0-9a-f]+ )/).map(text => {
      const [addresses, , offset, , , path = ""] = text.split("\n")[0].split(/\s+/);
      const [from, to] = addresses.split("-").map(address => parseInt(address, 16));
      return {
        path,
        start: parseInt(offset, 16),
        end: parseInt(offset, 16) + to - from,
        written: Number(/^Anonymous:\s+(\d+)/m.exec(text)?.[1]),
      };
    });
    const ofImage = mappings.filter(
      mapping => mapping.path === executable && mapping.start < end && mapping.end > image,
    );
    expect(ofImage.reduce((size, mapping) => size + mapping.end - mapping.start, 0)).toBeGreaterThanOrEqual(
      end - image,
    );
    expect(ofImage.filter(mapping => mapping.written)).toEqual([]);
  },
  120_000,
);

const llvmStrip = Bun.which("llvm-strip");

test.skipIf(!isLinux || !llvmStrip)(
  "llvm-strip leaves one copy of the payload",
  async () => {
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
  },
  120_000,
);

const withoutProc = [
  "unshare",
  "--user",
  "--map-root-user",
  "--mount",
  "sh",
  "-c",
  'mount -t tmpfs none /proc && exec "$0"',
];
const canUnmountProc =
  isLinux && Bun.spawnSync({ cmd: [...withoutProc, "true"], stdout: "ignore", stderr: "ignore" }).exitCode === 0;

// AddressSanitizer warns on stderr where it cannot read /proc.
test.skipIf(!canUnmountProc || isASAN)(
  "runs without /proc",
  async () => {
    using dir = tempDir("aot-code-mapping-no-proc", {
      "program.ts": `console.log(require("node:fs").existsSync("/proc/self/exe"), [3, 4].map(x => x * x).join());`,
    });
    expect(await run([...withoutProc, await build(String(dir))])).toEqual({
      stdout: "false 9,16\n",
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  },
  120_000,
);
