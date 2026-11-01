// An ARM64 processor predicts the target of a RET from a stack of the addresses that BL and BLR left behind. A stub that computes a
// return address into x30 and jumps to the callee, or that returns with BR, leaves that stack off by one: its own return is
// mispredicted, and so is every return to a frame that was already live. This reads the machine code of every copy of the stubs in
// an executable.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { built, slot, spawned } from "./harness/commands";
import { test } from "./supported";

const program = join(import.meta.dir, "parallel", "typed-objects", "detached-methods-many-lengths.ts");

/** Where the code of the image lies in an executable that holds one. */
function findCode(data: Buffer) {
  for (let start = data.indexOf("BUNAOT01"); start >= 0 && start <= data.length - 56;) {
    const [imageSize, codeOffset, codeSize] = [32, 40, 48].map(at => Number(data.readBigUInt64LE(start + at)));
    if (codeSize && codeOffset + codeSize <= imageSize && imageSize <= data.length - start)
      return { offset: start + codeOffset, size: codeSize };
    start = data.indexOf("BUNAOT01", start + 1);
  }
  throw new Error("the executable holds no image");
}

const RET = 0xd65f03c0;
const isAdrToLinkRegister = (word: number) => (word & 0x1f00001f) >>> 0 === 0x1000001e;
const isB = (word: number) => (word & 0xfc000000) >>> 0 === 0x14000000;
const isBl = (word: number) => (word & 0xfc000000) >>> 0 === 0x94000000;
const isBr = (word: number) => (word & 0xfffffc1f) >>> 0 === 0xd61f0000;
const isBlr = (word: number) => (word & 0xfffffc1f) >>> 0 === 0xd63f0000;
const isCopyOfLinkRegister = (word: number) => (word & 0xffffffe0) >>> 0 === 0xaa1e03e0;
const displacementOfB = (word: number) => 4 * (((word & 0x3ffffff) ^ 0x2000000) - 0x2000000);
const displacementOfAdr = (word: number) =>
  word >>> 31 ? undefined : (((((word >>> 5) & 0x7ffff) << 2) | ((word >>> 29) & 3)) ^ 0x100000) - 0x100000;
const registerOfBranch = (word: number) => (word >>> 5) & 31;

/** `map` is what the build wrote: T rows name the stubs, TN rows those that never return, C rows their copies, F rows the functions. */
function unpairedReturns(data: Buffer, map: string) {
  const code = findCode(data);
  const names = new Map<number, string>();
  const neverReturn = new Set<number>();
  const copies: number[] = [];
  const functions: number[] = [];
  for (const line of map.split(/\r?\n/)) {
    const [kind, first, second] = line.split("\t");
    if (kind === "T") {
      const known = names.get(Number(first));
      if (known === undefined || second!.length < known.length) names.set(Number(first), second!);
    } else if (kind === "TN") neverReturn.add(Number(first));
    else if (kind === "C") copies.push(Number(first));
    else if (kind === "F") functions.push(Number(second));
  }
  const offsets = [...names.keys()].sort((a, b) => a - b);
  const size = functions.reduce((end, at) => (at > copies[0]! && at < end ? at : end), code.size) - copies[0]!;
  const at = (offset: number) => {
    const stub = offsets.findLast(begin => begin <= offset)!;
    return `${names.get(stub)}+${offset - stub}`;
  };

  const found = new Set<string>();
  for (const copy of copies) {
    const words = Array.from({ length: size >> 2 }, (_, index) => data.readUInt32LE(code.offset + copy + 4 * index));
    if (!words.includes(RET)) found.add("no stub returns with ret");
    if (!words.some(isBlr)) found.add("no stub calls with blr");
    words.forEach((word, index) => {
      if (isAdrToLinkRegister(word)) {
        // A stub that never returns is handed the address that it reports.
        const next = words[index + 1];
        const reports = next !== undefined && isB(next) && neverReturn.has(4 * (index + 1) + displacementOfB(next));
        // A tail call that takes the place of frames below it hands its callee the address behind the call that the oldest of
        // them was entered by: that call left the address behind.
        const displacement = displacementOfAdr(word);
        const before = displacement === undefined ? undefined : words[index + (displacement >> 2) - 1];
        const isBehindCall = before !== undefined && (isBl(before) || isBlr(before));
        if (!reports && !isBehindCall) found.add(`${at(4 * index)} computes x30`);
      } else if (
        isBr(word) &&
        words
          .slice(Math.max(0, index - 3), index)
          .some(earlier => isCopyOfLinkRegister(earlier) && (earlier & 31) === registerOfBranch(word))
      )
        found.add(`${at(4 * index)} returns with br x${registerOfBranch(word)}`);
    });
  }
  return { stubs: offsets.length, copies: copies.length, found: [...found] };
}

test.skipIf(process.arch !== "arm64")(
  "no stub computes a return address or returns with an indirect jump",
  () =>
    slot(async () => {
      using dir = tempDir("aot-paired-returns", {});
      const folder = String(dir);
      const executable = join(folder, isWindows ? "entry.exe" : "entry");
      const map = join(folder, "entry.map");
      built(
        await spawned([bunExe(), "build", "--compile", "--aot", program, "--outfile", executable], folder, {
          ...bunEnv,
          BUN_JSC_aotMapFilePath: map,
        }),
      );

      const { stubs, copies, found } = unpairedReturns(readFileSync(executable), readFileSync(map, "utf8"));
      expect(found).toEqual([]);
      expect(stubs).toBeGreaterThan(100);
      expect(copies).toBeGreaterThan(0);
    }),
  300_000,
);
