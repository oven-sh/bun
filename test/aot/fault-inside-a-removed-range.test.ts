import { readTrimTable } from "bun:internal-for-testing";
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isLinux, isMacOS, tempDir } from "harness";
import { closeSync, openSync, readFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { locksEnvironment } from "./hardened";
import { withoutCoreDump } from "./harness/commands";
import "./harness/real-executables";
import { describe, test } from "./supported";
import { readRemovedFeatures } from "./trimmed-against-whole/removed-features";

// What `bun build --compile --aot` cuts out of the executable leaves a hole in its address space, which later mappings may fill.
const program = `import { CFunction, dlopen, read } from "bun:ffi";
import { openSync, readFileSync } from "node:fs";
const [how, hole, startOfFile] = process.argv.slice(2);
const isDarwin = process.platform === "darwin";
const libc = dlopen(isDarwin ? "/usr/lib/libSystem.B.dylib" : "libc.so.6", {
  mmap: { args: ["ptr", "usize", "i32", "i32", "i32", "i64"], returns: "ptr" },
  ...(isDarwin && { _dyld_get_image_vmaddr_slide: { args: ["u32"], returns: "i64" } }),
});
const slideOfLinux = () => {
  const ofThisFile = readFileSync("/proc/self/maps", "latin1").split("\\n").find(line => line.endsWith("/main"));
  return parseInt(ofThisFile ?? "", 16) - Number(startOfFile);
}; // @ts-expect-error
const address = Number(hole) + Number(isDarwin ? libc.symbols._dyld_get_image_vmaddr_slide(0) : slideOfLinux()); // @ts-expect-error
const call = () => new CFunction({ ptr: address, args: [], returns: "void" })();
const [read_write, read_execute, fixed_private, anonymous] = [3, 5, 0x12, isDarwin ? 0x1000 : 0x20];
const map = () => console.log("mapped", libc.symbols.mmap(address, 16384, read_write, fixed_private | anonymous, -1, 0) === address);
const mapFile = (file: string) =>
  console.log("mapped", libc.symbols.mmap(address, 16384, read_execute, fixed_private, openSync(file, "r"), 0) === address);
// As the npm package signal-exit does, and for the signals of a fault too. A breakpoint stops nothing then.
const signals = ["SIGTRAP", "SIGABRT", "SIGHUP", "SIGSEGV", "SIGBUS", "SIGILL"];
if (how.endsWith("listening")) for (const signal of signals) process.on(signal, () => {});
if (how.endsWith("not listening")) for (const signal of signals) process.removeAllListeners(signal);
console.log("started");
if (/^call( filled)?(,|$)/.test(how)) call();
if (how === "read") read.u8(address);
if (how === "call mapped data") (map(), call());
if (how === "read mapped data") (map(), console.log(read.u8(address)));
if (how.startsWith("call mapped file of ")) (mapFile(how.slice("call mapped file of ".length)), call());
`;

// What ends a process that fails a check, and `hlt` and `udf`, which removed code is filled with.
const instructions: Record<string, { bytes: number[]; cause: string }> =
  process.arch === "x64"
    ? {
        int3: { bytes: [0xcc], cause: "Trap instruction" },
        ud2: { bytes: [0x0f, 0x0b], cause: "Illegal instruction" },
        hlt: { bytes: [0xf4], cause: "Segmentation fault" },
      }
    : {
        brk: { bytes: [0x20, 0x00, 0x20, 0xd4], cause: "Trap instruction" },
        udf: { bytes: [0, 0, 0, 0], cause: "Illegal instruction" },
      };
const filler = Buffer.from(instructions[process.arch === "x64" ? "hlt" : "udf"].bytes);
const pagesOf = (bytes: number[]) => Buffer.alloc(16384, Buffer.from(bytes));

function segmentsOfElf(file: Buffer) {
  const [offset, size, count] = [Number(file.readBigUInt64LE(32)), file.readUInt16LE(54), file.readUInt16LE(56)];
  return Array.from({ length: count }, (_, index) => offset + index * size)
    .filter(header => file.readUInt32LE(header) === 1)
    .map(header => ({
      start: Number(file.readBigUInt64LE(header + 16)),
      end: Number(file.readBigUInt64LE(header + 16) + file.readBigUInt64LE(header + 40)),
      offset: Number(file.readBigUInt64LE(header + 8)),
      bytesInFile: Number(file.readBigUInt64LE(header + 32)),
      isCode: !!(file.readUInt32LE(header + 4) & 1),
    }));
}

function segmentsOfMachO(file: Buffer) {
  const segments: { start: number; end: number; offset: number; bytesInFile: number; isCode: boolean }[] = [];
  for (let command = 32, index = 0; index < file.readUInt32LE(16); command += file.readUInt32LE(command + 4), index++) {
    if (file.readUInt32LE(command) !== 0x19 || file.toString("latin1", command + 8, command + 18) === "__PAGEZERO")
      continue;
    const start = Number(file.readBigUInt64LE(command + 24));
    segments.push({
      start,
      end: start + Number(file.readBigUInt64LE(command + 32)),
      offset: Number(file.readBigUInt64LE(command + 40)),
      bytesInFile: Number(file.readBigUInt64LE(command + 48)),
      isCode: !!(file.readUInt32LE(command + 60) & 4),
    });
  }
  return segments;
}

function segmentsAndHoles(file: Buffer) {
  const segments = (isLinux ? segmentsOfElf(file) : segmentsOfMachO(file)).sort((a, b) => a.start - b.start);
  const holes = segments.slice(1).map(({ start }, index) => ({ start: segments[index].end, end: start }));
  return { segments, holes };
}

type Range = { start: number; end: number };
const overlaps = (some: Range[], others: Range[]) =>
  some
    .flatMap(a => others.map(b => ({ start: Math.max(a.start, b.start), end: Math.min(a.end, b.end) })))
    .filter(({ start, end }) => start < end);

function placesOfState(file: Buffer) {
  const { segments } = segmentsAndHoles(file);
  const places: { offset: number; address: number }[] = [];
  for (let at = file.indexOf("BUNFEAT\0"); at >= 0; at = file.indexOf("BUNFEAT\0", at + 1)) {
    const segment = segments.find(({ offset, bytesInFile }) => offset <= at && at < offset + bytesInFile);
    if (segment) places.push({ offset: at, address: segment.start + at - segment.offset });
  }
  return places;
}

function middleOfLargestHole(file: Buffer) {
  // A gap that Bun itself has was left by its linker, and a cut can adjoin it. One build had 4 MB between its first two segments.
  const cut = overlaps(segmentsAndHoles(file).holes, segmentsAndHoles(readFileSync(bunExe())).segments);
  const { start, end } = cut.sort((a, b) => b.end - b.start - (a.end - a.start))[0] ?? { start: 0, end: 0 };
  const middle = (start + end) / 2;
  return { address: middle - (middle % 0x4000), size: end - start };
}

// Whole pages are cut. What is left of removed code is filled.
function filledAddress(executable: string): number | undefined {
  const { ranges, sets } = readTrimTable(bunExe());
  const removed = new Set(readRemovedFeatures(executable));
  const removedCode = ranges.filter(({ isCode, set }) => isCode && sets[set].every(feature => removed.has(feature)));
  return overlaps(removedCode, segmentsAndHoles(readFileSync(executable)).segments)[0]?.start;
}

// Where Bun can't be cut, the executable gets a list of two removed ranges: 1 GB of addresses that nothing is mapped at, and
// one of the instructions that removed code is filled with, which its code or a constant in its code holds anyway.
function addRemovedRanges(executable: string) {
  const file = readFileSync(executable);
  const { segments } = segmentsAndHoles(file);
  const [sizeOfState, sizeOfRange] = [536, 16];
  const isWithoutRanges = ({ offset }: { offset: number }) =>
    file.subarray(offset + 8, offset + sizeOfState).every(byte => byte === 0);
  const [state, ...others] = placesOfState(file).filter(isWithoutRanges);
  if (!state || others.length) throw new Error("no state of removable features");
  const entry = Number(file.readBigUInt64LE(24));
  const code = segments.find(({ start, end }) => start <= entry && entry < end)!;
  const bytes = file.subarray(code.offset, code.offset + code.bytesInFile);
  let at = bytes.indexOf(filler);
  while (at >= 0 && (code.start + at) % filler.length) at = bytes.indexOf(filler, at + 1);
  if (at < 0) throw new Error("no " + filler.toString("hex"));
  const filled = code.start + at;

  const [terabyte, size] = [2 ** 40, 2 ** 30];
  const hole = Math.ceil(segments.at(-1)!.end / terabyte) * terabyte;
  const ranges = [
    { start: filled, size: filler.length },
    { start: hole, size },
  ];
  // No feature has an index as high as those of the last bytes of the state.
  const listOffset = sizeOfState - ranges.length * sizeOfRange;
  const commandLine = 128;
  const list = Buffer.alloc(ranges.length * sizeOfRange);
  for (const [index, range] of ranges.entries()) {
    list.writeBigInt64LE(BigInt(range.start - state.address), index * sizeOfRange);
    list.writeUInt32LE(range.size, index * sizeOfRange + 8);
    list.writeUInt16LE(commandLine, index * sizeOfRange + 12);
  }
  const header = Buffer.alloc(12);
  header.writeUInt32LE(ranges.length, 0);
  header.writeBigInt64LE(BigInt(listOffset), 4);
  const descriptor = openSync(executable, "r+");
  writeSync(descriptor, header, 0, header.length, state.offset + 12);
  writeSync(descriptor, list, 0, list.length, state.offset + listOffset);
  closeSync(descriptor);
  return { address: hole + size / 2, size, filled };
}

const offsetText = (offset: number) => (offset < 0 ? "-0x" : "+0x") + Math.abs(offset).toString(16);

describe.skipIf(!isLinux && !isMacOS)("a fault at an address inside a removed range", () => {
  const wanted: Record<string, unknown> = {
    "call": { stdout: "started\n", saysRemoved: true, exits70: true },
    "read": { stdout: "started\n", saysRemoved: false, exits70: false },
    "call mapped data": { stdout: "started\nmapped true\n", saysRemoved: false, exits70: false },
    "read mapped data": { stdout: "started\nmapped true\n0\n", saysRemoved: false, exits70: false },
    "call filled": { stdout: "started\n", saysRemoved: true, exits70: true },
    "call filled, listening": { stdout: "started\n", saysRemoved: true, exits70: true },
    "call, listening": { stdout: "started\n", saysRemoved: true, exits70: true },
    "call filled, not listening": { stdout: "started\n", saysRemoved: true, exits70: true },
    "call, not listening": { stdout: "started\n", saysRemoved: true, exits70: true },
  };
  // macOS maps no code that isn't signed.
  if (isLinux)
    for (const [name, { cause }] of Object.entries(instructions))
      wanted[`call mapped file of ${name}`] = {
        stdout: "started\nmapped true\n",
        saysRemoved: false,
        exits70: false,
        cause,
      };
  const found: Record<string, unknown> = {};
  // What fails today fails on macOS alone.
  const knownFailures: Record<string, boolean> = {
    // A crash is called "a removed feature" where none was called: a call into a mapped page that cannot be run.
    "call mapped data": isMacOS,
    // Removed code is still filled with breakpoints.
    "call filled, listening": isMacOS && process.arch === "x64",
    // After the last listener a fault has its default action there.
    "call filled, not listening": isMacOS,
    "call, not listening": isMacOS,
  };
  const failsToday = Object.keys(knownFailures).filter(how => knownFailures[how]);
  const withoutKnownFailures = (cases: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(cases).filter(([how]) => !failsToday.includes(how)));

  test("is called a removed feature only where removed code was called", async () => {
    const files = Object.entries(instructions).map(([name, { bytes }]) => [name, pagesOf(bytes)]);
    using dir = tempDir("fault-inside-a-removed-range", { "main.ts": program, ...Object.fromEntries(files) });
    const folder = String(dir);
    const spawned = async (cmd: string[]) => {
      await using child = Bun.spawn({
        cmd,
        cwd: folder,
        env: {
          ...bunEnv,
          NO_COLOR: "1",
          BUN_ENABLE_CRASH_REPORTING: "0",
          ...(!locksEnvironment && { BUN_CRASH_REPORT_URL: "" }),
        },
        stdout: "pipe",
        stderr: "pipe",
        timeout: 60_000,
        killSignal: "SIGKILL",
      });
      const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
      return { stdout, stderr, exitCode, signalCode: child.signalCode };
    };
    expect(await spawned([bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", "main"])).toMatchObject({
      exitCode: 0,
    });
    const executable = join(folder, "main");
    const largest = middleOfLargestHole(readFileSync(executable));
    const isCut = largest.size >= 1024 * 1024;
    // This Bun can't be cut. On macOS the file is signed, and AddressSanitizer reports crashes in place of Bun.
    if (!isCut && (!isLinux || isASAN)) return;
    const hole = isCut ? { ...largest, filled: filledAddress(executable) } : addRemovedRanges(executable);
    const file = readFileSync(executable);
    const states = placesOfState(file);
    const { start } = segmentsAndHoles(file).segments[0];

    const said: string[] = [];
    const stride = Math.floor(hole.size / 10 / 0x4000) * 0x4000;
    // Later mappings fill the hole from its start: on macOS its middle has held data by the time the program ran, and a call of data is
    // an ordinary fault. So "call" asks from the end of the hole on, and the others ask where it found nothing mapped.
    const places = [4, 3, 2, 1, 0, -1, -2, -3].map(steps => hole.address + steps * stride);
    let free = places[0];
    expect(hole.filled).toBeNumber();
    for (const how of Object.keys(wanted)) {
      for (const address of how === "call" ? places : how.startsWith("call filled") ? [hole.filled!] : [free]) {
        const cmd = withoutCoreDump([executable, how, String(address), String(start)]);
        const { stdout, stderr, exitCode, signalCode } = await spawned(cmd);
        said.push(
          `${how}: exit ${exitCode}, signal ${signalCode}, at ${address} of ${hole.size}\n${stderr.slice(0, 1500)}`,
        );
        const saysRemoved = / doesn't include .*, but the program needs it/.test(stderr);
        const cause = how.startsWith("call mapped file") && /: ([\w ]+) at address 0x/.exec(stderr)?.[1];
        found[how] = { stdout, saysRemoved, exits70: exitCode === 70, ...(cause !== false && { cause }) };
        if (saysRemoved) {
          // The sentence ends with where removed code was entered, counted from Bun__removableFeatureState.
          const place = /number: \d+([-+]0x[0-9a-f]+)/.exec(stderr)?.[1];
          expect(states.map(state => offsetText(address - state.address))).toContain(place);
          if (how === "call") free = address;
          break;
        }
      }
    }
    const [seen, expected] = [withoutKnownFailures(found), withoutKnownFailures(wanted)];
    if (said.length > Object.keys(wanted).length || !Bun.deepEquals(seen, expected)) console.error(said.join("\n"));
    expect(seen).toEqual(expected);
  }, 240_000);
});
