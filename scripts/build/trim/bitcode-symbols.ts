import { BuildError } from "../error.ts";
import { readAt } from "./binary-reader.ts";

const bitcodeMagic = 0x4243c0de;
const ENTER_SUBBLOCK = 1;
const DEFINE_ABBREV = 2;
const firstAbbreviation = 4;
const STRTAB_BLOCK = 23;
const SYMTAB_BLOCK = 25;
const [fixedEncoding, vbrEncoding] = [1, 2];
// llvm/Object/IRSymtab.h, namespace storage.
const [symbolsRangeAt, uncommonsRangeAt, symbolBytes] = [28, 36, 24];
// By the version of the table: how long an Uncommon is, and where COFFWeakExternFallbackName stands in it.
const uncommonLayouts = new Map([
  [2, { bytes: 24, targetAt: 8 }],
  [3, { bytes: 24, targetAt: 8 }],
  [4, { bytes: 28, targetAt: 12 }],
]);
const [hasUncommonFlag, weakFlag, indirectFlag] = [1 << 2, 1 << 4, 1 << 6];

export const isBitcodeAt = (fd: number, offset: number, size: number) =>
  size >= 4 && readAt(fd, offset, 4).readUInt32BE(0) === bitcodeMagic;

class Bits {
  at = 0;
  private readonly bytes: Buffer;

  constructor(bytes: Buffer) {
    this.bytes = bytes;
  }

  read(width: number): number {
    let value = 0;
    for (let bit = 0; bit < width; bit++, this.at++) {
      if ((this.bytes[this.at >> 3]! >> (this.at & 7)) & 1) value += 2 ** bit;
    }
    return value;
  }

  readVariable(width: number): number {
    const more = 2 ** (width - 1);
    let value = 0;
    for (let scale = 1; ; scale *= more) {
      const piece = this.read(width);
      value += (piece % more) * scale;
      if (piece < more) return value;
    }
  }

  alignToWord(): void {
    this.at = Math.ceil(this.at / 32) * 32;
  }
}

/** The one record of a block that holds one blob, as the writer of bitcode lays out the symbol table and the string table. */
function blobOf(block: Buffer, abbreviationWidth: number): Buffer | undefined {
  const bits = new Bits(block);
  while (bits.at + abbreviationWidth <= block.length * 8) {
    const id = bits.read(abbreviationWidth);
    if (id === DEFINE_ABBREV) {
      for (let operands = bits.readVariable(5); operands > 0; operands--) {
        if (bits.read(1)) bits.readVariable(8);
        else if ([fixedEncoding, vbrEncoding].includes(bits.read(3))) bits.readVariable(5);
      }
    } else if (id >= firstAbbreviation) {
      const length = bits.readVariable(6);
      bits.alignToWord();
      return block.subarray(bits.at / 8, bits.at / 8 + length);
    } else return undefined;
  }
  return undefined;
}

/**
 * The weak aliases that a file of LLVM bitcode for COFF defines, each with the name it stands for: `??_EFoo@@..`, the vector deleting
 * destructor, for `??_GFoo@@..`. From the symbol table that the file carries. lld-link reads them there when it parses the file, and
 * what it compiles from the file only refers to them.
 */
export function readWeakAliases(
  fd: number,
  offset: number,
  size: number,
  file: string,
): [name: string, target: string][] {
  if (size < 8 || !isBitcodeAt(fd, offset, size)) return [];
  let symbols: Buffer | undefined;
  let strings: Buffer | undefined;
  for (let at = 4; at + 8 <= size;) {
    const head = new Bits(readAt(fd, offset + at, Math.min(16, size - at)));
    if (head.read(2) !== ENTER_SUBBLOCK) break;
    const block = head.readVariable(8);
    const abbreviationWidth = head.readVariable(4);
    head.alignToWord();
    const length = head.read(32) * 4;
    const start = at + head.at / 8;
    if (start + length > size) throw new BuildError("a block of bitcode runs past the end of the file", { file });
    if (block === SYMTAB_BLOCK) symbols = blobOf(readAt(fd, offset + start, length), abbreviationWidth);
    else if (block === STRTAB_BLOCK) strings = blobOf(readAt(fd, offset + start, length), abbreviationWidth);
    at = start + length;
  }
  if (symbols === undefined || strings === undefined) {
    throw new BuildError("a file of bitcode carries no symbol table: its weak aliases cannot be told", { file });
  }
  const [table, names] = [symbols, strings];
  const rangeAt = (at: number, bytes: number) => {
    const [start, count] = [table.readUInt32LE(at), table.readUInt32LE(at + 4)];
    if (start + count * bytes > table.length)
      throw new BuildError("the symbol table of a file of bitcode is cut short", { file });
    return { start, count };
  };
  const textAt = (at: number) => {
    const start = table.readUInt32LE(at);
    return names.toString("latin1", start, start + table.readUInt32LE(at + 4));
  };
  const layout = uncommonLayouts.get(table.readUInt32LE(0));
  if (layout === undefined) {
    throw new BuildError(
      `the symbol table of a file of bitcode has version ${table.readUInt32LE(0)}, which this reader does not know`,
      { file },
    );
  }
  const listed = rangeAt(symbolsRangeAt, symbolBytes);
  const uncommons = rangeAt(uncommonsRangeAt, layout.bytes);
  const aliases: [string, string][] = [];
  for (let number = 0, uncommon = 0; number < listed.count; number++) {
    const symbol = listed.start + number * symbolBytes;
    const flags = table.readUInt32LE(symbol + 20);
    if (!(flags & hasUncommonFlag)) continue;
    if (uncommon >= uncommons.count)
      throw new BuildError("the symbol table of a file of bitcode is cut short", { file });
    const target = textAt(uncommons.start + uncommon++ * layout.bytes + layout.targetAt);
    if (flags & weakFlag && flags & indirectFlag && target !== "") aliases.push([textAt(symbol), target]);
  }
  return aliases;
}
