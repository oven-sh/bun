// Reading and moving a PE executable, for the packer.
//
// The Windows host is an INPUT FILE: a person builds it on real Windows with
// clang for the MSVC target (see tools/windows-host.ts for the commands). It
// is linked normally, so its DOS header is 64 bytes, a small DOS stub
// follows, and e_lfanew is 0x78. The packed file needs the APE magic and the
// shell script in that place, so this module moves the PE header further in,
// by a multiple of FileAlignment, and corrects every file offset that the PE
// format stores:
//
//   e_lfanew                              the new place of the PE signature
//   SizeOfHeaders                         grows by the same amount
//   PointerToSymbolTable (COFF)           the symbol table moves with the rest
//   section PointerToRawData,
//     PointerToRelocations,
//     PointerToLineNumbers
//   data directory 4 (certificate table)  a file offset, not an RVA
//   debug directory entries PointerToRawData
//   CheckSum                              set to 0, see clearCheckSum
//
// Nothing else in a PE file names a file offset. Virtual addresses do not
// change at all, so imports, base relocations, the exception table (.pdata /
// unwind data) and the load config are carried over byte for byte and keep
// working at the addresses they already had.
//
// The limit is the first section: Windows maps the header region at the image
// base, so SizeOfHeaders has to stay at or below the smallest section RVA.
// With FileAlignment 512, SizeOfHeaders 0x400 and a first section at RVA
// 0x1000 (what clang/lld produce) the script may be up to 0xc78 bytes long.

export type Section = {
  name: string;
  virtualSize: number;
  virtualAddress: number;
  rawSize: number;
  rawPointer: number;
  relocPointer: number;
  lineNumberPointer: number;
  characteristics: number;
  /** Offset of this section header in the file. */
  at: number;
};

export type Pe = {
  lfanew: number;
  machine: number;
  sectionCount: number;
  optionalHeaderSize: number;
  symbolTablePointer: number;
  symbolCount: number;
  stringTableSize: number;
  fileAlignment: number;
  sectionAlignment: number;
  sizeOfHeaders: number;
  checkSum: number;
  dataDirectoryAt: number;
  dataDirectoryCount: number;
  sections: Section[];
  /** End of everything in the file that the PE format describes. */
  end: number;
  /** Largest SizeOfHeaders the first section allows. */
  headerRoom: number;
};

const MACHINE_NAMES: Record<number, string> = { 0x8664: "x86_64", 0xaa64: "aarch64" };

export function machineName(machine: number): string {
  return MACHINE_NAMES[machine] ?? `0x${machine.toString(16)}`;
}

function stringTableSize(file: Buffer, symbolTablePointer: number, symbolCount: number): number {
  if (!symbolTablePointer) return 0;
  const at = symbolTablePointer + 18 * symbolCount;
  return at + 4 <= file.length ? file.readUInt32LE(at) : 0;
}

export function readPe(file: Buffer): Pe {
  if (file.toString("latin1", 0, 2) !== "MZ") throw new Error("not a PE file: it does not start with MZ");
  const lfanew = file.readUInt32LE(0x3c);
  if (file.toString("latin1", lfanew, lfanew + 4) !== "PE\0\0") {
    throw new Error(`no PE signature at e_lfanew (0x${lfanew.toString(16)})`);
  }
  const coff = lfanew + 4;
  const machine = file.readUInt16LE(coff);
  const sectionCount = file.readUInt16LE(coff + 2);
  const symbolTablePointer = file.readUInt32LE(coff + 8);
  const symbolCount = file.readUInt32LE(coff + 12);
  const optionalHeaderSize = file.readUInt16LE(coff + 16);
  const opt = coff + 20;
  const magic = file.readUInt16LE(opt);
  if (magic !== 0x20b) throw new Error(`only PE32+ is handled here (optional header magic 0x${magic.toString(16)})`);
  const sectionAlignment = file.readUInt32LE(opt + 32);
  const fileAlignment = file.readUInt32LE(opt + 36);
  const sizeOfHeaders = file.readUInt32LE(opt + 60);
  const checkSum = file.readUInt32LE(opt + 64);
  const dataDirectoryCount = file.readUInt32LE(opt + 108);
  const dataDirectoryAt = opt + 112;
  const sectionTableAt = opt + optionalHeaderSize;
  const sections: Section[] = [];
  for (let i = 0; i < sectionCount; i++) {
    const at = sectionTableAt + 40 * i;
    sections.push({
      name: file.toString("latin1", at, at + 8).replace(/\0+$/, ""),
      virtualSize: file.readUInt32LE(at + 8),
      virtualAddress: file.readUInt32LE(at + 12),
      rawSize: file.readUInt32LE(at + 16),
      rawPointer: file.readUInt32LE(at + 20),
      relocPointer: file.readUInt32LE(at + 24),
      lineNumberPointer: file.readUInt32LE(at + 28),
      characteristics: file.readUInt32LE(at + 36),
      at,
    });
  }
  let end = sizeOfHeaders;
  for (const s of sections) if (s.rawPointer) end = Math.max(end, s.rawPointer + s.rawSize);
  if (symbolTablePointer) {
    end = Math.max(end, symbolTablePointer + 18 * symbolCount + stringTableSize(file, symbolTablePointer, symbolCount));
  }
  if (dataDirectoryCount > 4) {
    const certOff = file.readUInt32LE(dataDirectoryAt + 4 * 8);
    const certSize = file.readUInt32LE(dataDirectoryAt + 4 * 8 + 4);
    if (certOff) end = Math.max(end, certOff + certSize);
  }
  const withData = sections.filter(s => s.rawSize);
  return {
    lfanew,
    machine,
    sectionCount,
    optionalHeaderSize,
    symbolTablePointer,
    symbolCount,
    stringTableSize: stringTableSize(file, symbolTablePointer, symbolCount),
    fileAlignment,
    sectionAlignment,
    sizeOfHeaders,
    checkSum,
    dataDirectoryAt,
    dataDirectoryCount,
    sections,
    end,
    headerRoom: withData.length ? Math.min(...withData.map(s => s.virtualAddress)) : sizeOfHeaders,
  };
}

function fileOffsetOfRva(pe: Pe, rva: number): number | null {
  for (const s of pe.sections) {
    if (rva >= s.virtualAddress && rva < s.virtualAddress + Math.max(s.virtualSize, s.rawSize)) {
      return s.rawPointer ? s.rawPointer + (rva - s.virtualAddress) : null;
    }
  }
  return null;
}

export type MovedPe = {
  /** The host file from the PE signature on: the DOS area is gone. */
  body: Buffer;
  /** Where the PE signature sits in the packed file. */
  lfanew: number;
  /** How far every file offset moved. */
  delta: number;
  /** End of what the PE format describes, in the packed file. */
  end: number;
  pe: Pe;
};

/**
 * Moves the PE header of `file` so that the PE signature lands at `lfanew`,
 * and corrects every file offset the format stores. The move has to be a
 * multiple of FileAlignment, so that the raw data of every section stays
 * aligned the way Windows requires.
 */
export function movePe(file: Buffer, lfanew: number): MovedPe {
  const pe = readPe(file);
  const delta = lfanew - pe.lfanew;
  if (delta < 0) throw new Error("the PE header cannot move backwards");
  if (delta % pe.fileAlignment) {
    throw new Error(`the PE header has to move by a multiple of FileAlignment (${pe.fileAlignment}), not ${delta}`);
  }
  if (pe.sizeOfHeaders + delta > pe.headerRoom) {
    throw new Error(
      `SizeOfHeaders would become 0x${(pe.sizeOfHeaders + delta).toString(16)}, past the first section RVA 0x${pe.headerRoom.toString(16)}`,
    );
  }
  if (lfanew + 4 + 20 + pe.optionalHeaderSize + 40 * pe.sectionCount > pe.sizeOfHeaders + delta) {
    throw new Error("the PE header and the section table would not fit in SizeOfHeaders");
  }
  if (pe.dataDirectoryCount > 11 && file.readUInt32LE(pe.dataDirectoryAt + 11 * 8)) {
    throw new Error("this PE file has a bound import directory, which holds file offsets this tool does not rewrite");
  }

  const out = Buffer.from(file); // a copy: the input file is never touched
  out.writeUInt32LE(lfanew, 0x3c);
  const coff = pe.lfanew + 4;
  const opt = coff + 20;
  if (pe.symbolTablePointer) out.writeUInt32LE(pe.symbolTablePointer + delta, coff + 8);
  out.writeUInt32LE(pe.sizeOfHeaders + delta, opt + 60);
  if (pe.dataDirectoryCount > 4) {
    // The certificate table (Authenticode) is named by a file offset.
    const at = pe.dataDirectoryAt + 4 * 8;
    const off = out.readUInt32LE(at);
    if (off) out.writeUInt32LE(off + delta, at);
  }
  if (pe.dataDirectoryCount > 6) {
    // Every debug directory entry names its data by RVA and by file offset.
    const rva = file.readUInt32LE(pe.dataDirectoryAt + 6 * 8);
    const size = file.readUInt32LE(pe.dataDirectoryAt + 6 * 8 + 4);
    if (rva && size) {
      const at = fileOffsetOfRva(pe, rva);
      if (at === null) throw new Error("the debug directory is in a section without raw data");
      for (let i = 0; i + 28 <= size; i += 28) {
        const field = at + i + 24;
        const off = out.readUInt32LE(field);
        if (off) out.writeUInt32LE(off + delta, field);
      }
    }
  }
  for (const s of pe.sections) {
    if (s.rawPointer) out.writeUInt32LE(s.rawPointer + delta, s.at + 20);
    if (s.relocPointer) out.writeUInt32LE(s.relocPointer + delta, s.at + 24);
    if (s.lineNumberPointer) out.writeUInt32LE(s.lineNumberPointer + delta, s.at + 28);
  }
  return { body: out.subarray(pe.lfanew), lfanew, delta, end: pe.end + delta, pe };
}

/**
 * The packed file gets CheckSum 0, which is the value lld writes and the one
 * that means "not computed". Windows verifies the checksum of a driver, not of
 * a program, and signtool computes its own when a file is signed. A host that
 * was linked with a checksum loses it here, because the bytes it covered moved.
 */
export function clearCheckSum(out: Buffer, lfanew: number): void {
  out.writeUInt32LE(0, lfanew + 4 + 20 + 64);
}

/** The largest e_lfanew that `file` allows: how much room the script has. */
export function headerRoomFor(file: Buffer): number {
  const pe = readPe(file);
  const maxDelta = Math.floor((pe.headerRoom - pe.sizeOfHeaders) / pe.fileAlignment) * pe.fileAlignment;
  return pe.lfanew + maxDelta;
}
