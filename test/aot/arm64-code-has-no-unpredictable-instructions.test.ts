// ARM64 leaves the outcome of some encodings to the core: a load or a store that writes its base register back and names that
// same register as the one it loads or stores, a pair that loads one register twice, an exclusive store whose status register
// is one of its operands. One core traps on them, another stores a value the compiler did not mean, so a program may answer
// rightly on the machine that tests it and die on the next. This test reads every instruction of the functions and stubs of
// an executable and looks for such encodings. The back end once made `str x0, [x0], #152` out of "store the address of the
// end of a buffer at its start", which is how a text that grows in the frame of its function begins.
import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned, unsupported } from "./run-programs";

const programs = [
  "strings/string-builder-in-the-frame.ts",
  "language/baseline-cpu.ts",
  "typed-objects/detached-methods-many-lengths.ts",
];

function codeOf(executable: Buffer) {
  const magic = Buffer.from("BUNAOT01", "latin1");
  for (let at = executable.indexOf(magic); at >= 0; at = executable.indexOf(magic, at + 1)) {
    if (at + 56 > executable.length) break;
    const size = Number(executable.readBigUInt64LE(at + 32));
    const codeOffset = Number(executable.readBigUInt64LE(at + 40));
    const codeSize = Number(executable.readBigUInt64LE(at + 48));
    if (codeSize > 0 && codeOffset + codeSize <= size && at + size <= executable.length)
      return executable.subarray(at + codeOffset, at + codeOffset + codeSize);
  }
  throw new Error("the executable holds no image of compiled code");
}

const stackPointer = 31;

export function unpredictableForm(word: number): string | undefined {
  const rt = word & 31;
  const rn = (word >>> 5) & 31;
  const rt2 = (word >>> 10) & 31;
  const isVector = (word >>> 26) & 1;
  const group = (word >>> 27) & 7;
  // Load or store of one register, immediate, pre- or post-indexed.
  if (group === 7 && ((word >>> 24) & 3) === 0 && !((word >>> 21) & 1) && (word >>> 10) & 1 && !isVector)
    if (rn === rt && rn !== stackPointer) return "a register is loaded or stored through itself with write-back";
  if (group === 5 && !((word >>> 25) & 1)) {
    const mode = (word >>> 23) & 3;
    const isLoad = (word >>> 22) & 1;
    if ((mode === 1 || mode === 3) && !isVector && rn !== stackPointer && (rn === rt || rn === rt2))
      return "a pair is loaded or stored through one of its registers with write-back";
    if (isLoad && rt === rt2) return "a pair is loaded into one register";
  }
  // Exclusive store of one register or of a pair.
  if (((word >>> 24) & 0x3f) === 8 && !((word >>> 23) & 1) && !((word >>> 22) & 1)) {
    const status = (word >>> 16) & 31;
    if (status === rt || (status === rn && rn !== stackPointer))
      return "the status register of an exclusive store is an operand";
  }
  return undefined;
}

export function findUnpredictableForms(code: Buffer, map: string): string[] {
  const starts: { start: number; end?: number; name: string }[] = [];
  for (const line of map.split("\n")) {
    const fields = line.split("\t");
    if (fields[0] === "F")
      starts.push({
        start: Number(fields[2]),
        end: Number(fields[2]) + Number(fields[3]),
        name: fields[7] || "a module",
      });
    else if (fields[0] === "T") starts.push({ start: Number(fields[1]), name: "stub " + fields[2] });
  }
  starts.sort((a, b) => a.start - b.start);
  const found: string[] = [];
  starts.forEach(({ start, end, name }, index) => {
    const limit = end ?? starts[index + 1]?.start ?? start;
    for (let at = start; at + 4 <= limit; at += 4) {
      const form = unpredictableForm(code.readUInt32LE(at));
      if (form) found.push(`${name} + ${at - start}: ${code.readUInt32LE(at).toString(16)}: ${form}`);
    }
  });
  return found;
}

test("the scan knows the encodings it looks for", () => {
  const found = (word: number) => unpredictableForm(word) !== undefined;
  // str x0, [x0], #152 . str x1, [x0], #152 . str x0, [sp, #-16]! . ldr x3, [x3, #8]! . ldr x3, [x3, #8]
  expect([0xf8098400, 0xf8098401, 0xf81f0fe0, 0xf8408c63, 0xf9400463].map(found)).toEqual([
    true,
    false,
    false,
    true,
    false,
  ]);
  // stp x29, x30, [sp, #-16]! . stp x1, x2, [x1], #16 . ldp x4, x4, [x0] . ldp x4, x5, [x0] . ldp d4, d4, [x0]
  expect([0xa9bf7bfd, 0xa8810821, 0xa9401004, 0xa9401404, 0x6d401004].map(found)).toEqual([
    false,
    true,
    true,
    false,
    true,
  ]);
  // stxr w1, x1, [x0] . stxr w0, x1, [x0] . stxr w2, x1, [x0] . ldxr x1, [x0]
  expect([0xc8017c01, 0xc8007c01, 0xc8027c01, 0xc85f7c01].map(found)).toEqual([true, true, false, false]);
});

test.skipIf(!!unsupported || process.arch !== "arm64").each(programs)(
  "no instruction of %s is left to the core",
  async name => {
    await slot(async () => {
      const program = join(import.meta.dir, "programs", name);
      using dir = tempDir("aot-arm64-unpredictable", {});
      const folder = String(dir);
      const executable = join(folder, isWindows ? "entry.exe" : "entry");
      const mapPath = join(folder, "entry.map");
      built(
        await spawned(
          [bunExe(), "build", "--compile", "--aot", "--aot-threads=1", program, "--outfile", executable],
          folder,
          {
            ...bunEnv,
            BUN_JSC_aotMapFilePath: mapPath,
          },
        ),
      );
      expect(findUnpredictableForms(codeOf(readFileSync(executable)), readFileSync(mapPath, "utf8"))).toEqual([]);
    });
  },
  600_000,
);
