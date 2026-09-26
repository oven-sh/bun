// The ad-hoc Apple code signature of the image inside the packed file.
//
// A port of misctools/portable/tools/apple_sign.py with one change: the signed
// range does not start at offset 0 of a file of its own, it starts where the
// image lies in the packed file.
//
// Apple Silicon maps file pages executable only under a code signature. The
// macOS stub (host/host_posix.c) registers this one with
// fcntl(F_ADDFILESIGS_RETURN), which takes
//   fs_file_start  the offset of the slice in the file   -> the image offset
//   fs_blob_start  the offset of the blob, from the slice
//   fs_blob_size   its length
// exactly as dyld registers the signature of one slice of a fat Mach-O file.
// The hashes of the CodeDirectory are the hashes of the 4 KiB pages that
// follow fs_file_start, so the signature covers the image at its FINAL
// offsets in the container, and signing is the last step of packing.
import { createHash } from "node:crypto";
import { APPLE_PAGE } from "./format.ts";

export const HASH_PAGE = 4096;
export const IDENT = "bun.portable.image\0";
/** Size of the CodeDirectory in front of the identifier and the hashes. */
const CD_HEAD = 88;

/** Length of the signature of a range of `codeLen` bytes. */
export function signatureLength(codeLen: number): number {
  return 20 + CD_HEAD + IDENT.length + 32 * Math.ceil(codeLen / HASH_PAGE);
}

/** The signed range is whole 16 KiB pages: the page size of macOS on arm64. */
export function signedLength(imageLen: number): number {
  return Math.ceil(imageLen / APPLE_PAGE) * APPLE_PAGE;
}

/**
 * The SuperBlob with one CodeDirectory over `code`, which has to be the bytes
 * of the signed range as they lie in the finished file.
 */
export function signature(code: Buffer): Buffer {
  const slots = Math.ceil(code.length / HASH_PAGE);
  const hashOff = CD_HEAD + IDENT.length;
  const cdLen = hashOff + 32 * slots;
  if (code.length >= 2 ** 32) throw new Error("codeLimit is a 32 bit field");
  const cd = Buffer.alloc(cdLen);
  cd.writeUInt32BE(0xfade0c02, 0); // CSMAGIC_CODEDIRECTORY
  cd.writeUInt32BE(cdLen, 4);
  cd.writeUInt32BE(0x20400, 8); // version
  cd.writeUInt32BE(0x20002, 12); // flags: adhoc, linker-signed
  cd.writeUInt32BE(hashOff, 16);
  cd.writeUInt32BE(CD_HEAD, 20); // identOffset
  cd.writeUInt32BE(0, 24); // special slots
  cd.writeUInt32BE(slots, 28);
  cd.writeUInt32BE(code.length, 32); // codeLimit
  cd[36] = 32; // hash size
  cd[37] = 2; // SHA-256
  cd[38] = 0; // platform
  cd[39] = 12; // log2 of the hash page
  // spare2, scatterOffset, teamOffset, spare3 and codeLimit64 stay 0
  cd.writeBigUInt64BE(0n, 64); // execSegBase
  cd.writeBigUInt64BE(BigInt(code.length), 72); // execSegLimit
  cd.writeBigUInt64BE(0n, 80); // execSegFlags
  cd.write(IDENT, CD_HEAD, "latin1");
  for (let i = 0; i < slots; i++) {
    const page = code.subarray(i * HASH_PAGE, Math.min((i + 1) * HASH_PAGE, code.length));
    createHash("sha256").update(page).digest().copy(cd, hashOff + 32 * i);
  }
  const sb = Buffer.alloc(20);
  sb.writeUInt32BE(0xfade0cc0, 0); // CSMAGIC_EMBEDDED_SIGNATURE
  sb.writeUInt32BE(20 + cdLen, 4);
  sb.writeUInt32BE(1, 8); // one blob
  sb.writeUInt32BE(0, 12); // slot type 0: CodeDirectory
  sb.writeUInt32BE(20, 16); // its offset
  return Buffer.concat([sb, cd]);
}
