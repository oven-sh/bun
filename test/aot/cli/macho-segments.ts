/** What the load commands of a 64-bit Mach-O file say of its segments and of their sections. */

const segmentCommand = 0x19;
const segmentCommandSize = 72;
const sectionSize = 80;

export const protection = { read: 1, write: 2, execute: 4 } as const;
/** S_ATTR_PURE_INSTRUCTIONS and S_ATTR_SOME_INSTRUCTIONS: either says that the section holds machine code. */
export const instructionAttributes = 0x80000400;

function nameAt(file: Buffer, offset: number) {
  const name = file.subarray(offset, offset + 16);
  const end = name.indexOf(0);
  return name.toString("latin1", 0, end < 0 ? 16 : end);
}

export type MachOSection = ReturnType<typeof readMachOSegments>[number]["sections"][number];
export type MachOSegment = ReturnType<typeof readMachOSegments>[number];

/** In the order of the load commands. A part that `--trim` or `--aot` has made of a segment keeps the names of its sections. */
export function readMachOSegments(file: Buffer) {
  if (file.readUInt32LE(0) !== 0xfeedfacf) throw new Error("not a 64-bit Mach-O file");
  const segments = [];
  let at = 32;
  for (let command = 0; command < file.readUInt32LE(16); command++) {
    const size = file.readUInt32LE(at + 4);
    if (file.readUInt32LE(at) === segmentCommand) {
      const sections = Array.from({ length: file.readUInt32LE(at + 64) }, (_, index) => {
        const section = at + segmentCommandSize + index * sectionSize;
        return {
          name: nameAt(file, section),
          segment: nameAt(file, section + 16),
          address: Number(file.readBigUInt64LE(section + 32)),
          size: Number(file.readBigUInt64LE(section + 40)),
          offset: file.readUInt32LE(section + 48),
          holdsInstructions: (file.readUInt32LE(section + 64) & instructionAttributes) !== 0,
        };
      });
      segments.push({
        name: nameAt(file, at + 8),
        address: Number(file.readBigUInt64LE(at + 24)),
        size: Number(file.readBigUInt64LE(at + 32)),
        offset: Number(file.readBigUInt64LE(at + 40)),
        fileSize: Number(file.readBigUInt64LE(at + 48)),
        maxProtection: file.readInt32LE(at + 56),
        protection: file.readInt32LE(at + 60),
        sections,
      });
    }
    at += size;
  }
  return segments;
}

/** The segments that hold the embedded program: one, or one for each part where the program has compiled code. */
export function payloadSegments(file: Buffer) {
  return readMachOSegments(file).filter(segment => segment.name === "__BUN" || segment.name.startsWith("__BUN."));
}
