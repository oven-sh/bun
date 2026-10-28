import { readFileSync } from "node:fs";

const programHeaderType = { load: 1, dynamic: 2, stack: 0x6474e551 };
const dynamicTag = { needed: 1, hash: 4, stringTable: 5, symbolTable: 6, libraryPath: 15, runPath: 29, earlyInitializersSize: 33, packedRelocationsSize: 35 };
const mayExecute = 1;

export interface ElfFile {
  stackFlags: number | undefined;
  neededLibraries: string[];
  librarySearchPaths: string[];
  importedSymbols: Set<string>;
  earlyInitializers: number;
  packedRelocationsSize: number;
  countInCode(pattern: RegExp): number;
  contains(text: string): boolean;
}

export const [stackMayBeRead, stackMayBeWritten] = [4, 2];

export function readElfFile(path: string): ElfFile {
  const file = readFileSync(path);
  if (file.readUInt32BE(0) !== 0x7f454c46 || file[4] !== 2 || file[5] !== 1) throw new Error(path + " is not a little-endian ELF64 file");
  const word = (offset: number) => Number(file.readBigUInt64LE(offset));
  const headersAt = word(32);
  const headerSize = file.readUInt16LE(54);
  const headers = Array.from({ length: file.readUInt16LE(56) }, (_, index) => {
    const at = headersAt + index * headerSize;
    return { type: file.readUInt32LE(at), flags: file.readUInt32LE(at + 4), offset: word(at + 8), address: word(at + 16), size: word(at + 32) };
  });
  const loads = headers.filter(header => header.type === programHeaderType.load);
  const offsetOf = (address: number) => {
    const segment = loads.find(load => address >= load.address && address < load.address + load.size);
    if (!segment) throw new Error("no segment of " + path + " holds the address " + address.toString(16));
    return address - segment.address + segment.offset;
  };
  const textAt = (offset: number) => file.toString("latin1", offset, file.indexOf(0, offset));

  const entries: { tag: number; value: number }[] = [];
  const dynamic = headers.find(header => header.type === programHeaderType.dynamic);
  for (let at = dynamic?.offset ?? 0; dynamic && at < dynamic.offset + dynamic.size && word(at) !== 0; at += 16) entries.push({ tag: word(at), value: word(at + 8) });
  const valueOf = (tag: number) => entries.find(entry => entry.tag === tag)?.value;
  const strings = valueOf(dynamicTag.stringTable);
  const namesOf = (tag: number) => entries.filter(entry => entry.tag === tag).map(entry => textAt(offsetOf(strings!) + entry.value));

  const importedSymbols = new Set<string>();
  const symbols = valueOf(dynamicTag.symbolTable);
  const hash = valueOf(dynamicTag.hash);
  if (symbols !== undefined && hash !== undefined) {
    const count = file.readUInt32LE(offsetOf(hash) + 4);
    for (let index = 1; index < count; index++) {
      const at = offsetOf(symbols) + index * 24;
      if (file.readUInt16LE(at + 6) === 0) importedSymbols.add(textAt(offsetOf(strings!) + file.readUInt32LE(at)));
    }
  }

  return {
    stackFlags: headers.find(header => header.type === programHeaderType.stack)?.flags,
    neededLibraries: namesOf(dynamicTag.needed),
    librarySearchPaths: [...namesOf(dynamicTag.libraryPath), ...namesOf(dynamicTag.runPath)],
    importedSymbols,
    earlyInitializers: (valueOf(dynamicTag.earlyInitializersSize) ?? 0) / 8,
    packedRelocationsSize: valueOf(dynamicTag.packedRelocationsSize) ?? 0,
    countInCode: pattern =>
      loads
        .filter(load => load.flags & mayExecute)
        .reduce((sum, load) => sum + (file.toString("latin1", load.offset, load.offset + load.size).match(pattern)?.length ?? 0), 0),
    contains: text => file.includes(text),
  };
}
