/**
 * Byte offsets of members of JSC::AOT::ImageHeader (aot/image/AOTImageFormat.h in WebKit).
 * `prefixSize` is the size of the part of the header that tells an image from other bytes.
 */
export const imageHeader = {
  magic: 0,
  stamp: 8,
  identity: 16,
  size: 32,
  codeOffset: 40,
  prefixSize: 48,
  codeSize: 48,
  executableSize: 64,
  formatVersion: 72,
  sections: 208,
  numberOfSections: 27,
  constantsOffset: 464,
  constantsSize: 468,
} as const;

const minFileAlignment = 512;
const minImagePageSize = 16384n;

function isImageHeader(executable: Buffer, at: number): boolean {
  if (at % minFileAlignment !== 0 || at + imageHeader.prefixSize > executable.length) return false;
  const size = executable.readBigUInt64LE(at + imageHeader.size);
  const codeOffset = executable.readBigUInt64LE(at + imageHeader.codeOffset);
  return (
    size > 0n &&
    size % minImagePageSize === 0n &&
    codeOffset > 0n &&
    codeOffset % minImagePageSize === 0n &&
    codeOffset < size &&
    BigInt(at) + size <= BigInt(executable.length)
  );
}

/** The offsets in the file at which the executable's compiled images start, in order. */
export function findImages(executable: Buffer): number[] {
  const magic = Buffer.from("BUNAOT01", "latin1");
  const found: number[] = [];
  // Bun's own code holds the same eight bytes as an immediate, so the magic alone does not identify a header.
  for (let at = executable.indexOf(magic); at >= 0; at = executable.indexOf(magic, at + 1)) {
    if (isImageHeader(executable, at)) found.push(at);
  }
  return found;
}

/** The offset in the file at which the executable's compiled image starts. Throws unless there is exactly one. */
export function findImage(executable: Buffer): number {
  const found = findImages(executable);
  if (found.length !== 1) throw new Error(`expected one compiled image in the executable, found ${found.length}`);
  return found[0];
}
