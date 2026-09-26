/**
 * Append an ad-hoc Apple code signature for the whole image file to the image.
 *
 * Apple Silicon maps file pages executable only if a code signature covers them.
 * The macOS host (host/host_posix.c) registers this signature with
 * fcntl(F_ADDFILESIGS_RETURN) and then maps the segments from the file. The
 * signature has the layout that probe/apple_signed_map.c tested on macOS arm64:
 * a SuperBlob with one CodeDirectory, SHA-256 over 4 KiB pages, ad-hoc.
 *
 *   bun tools/apple_sign.ts <image>            sign in place
 *   bun tools/apple_sign.ts --blob <file>      print the signature of <file> as it is (for tests)
 *
 * File after signing:
 *   image | zeros up to a multiple of 16 KiB | signature | trailer
 *   trailer: 5 x u64, little endian: code_off (0), code_len, sig_off, sig_len, MAGIC
 *
 * Every other host ignores what follows the ELF data. Sign last: any change to
 * the first code_len bytes makes the signature wrong.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const HASH_PAGE = 4096;
/** Page size of macOS on arm64. */
const ALIGN = 16384;
/** The last 8 bytes of a signed image. */
const MAGIC = Buffer.from("BUNSIG01", "latin1");
const IDENT = Buffer.from("bun.portable.image\0", "latin1");
const TRAILER_SIZE = 40;
const CODE_DIRECTORY_SIZE = 88;

/** The SuperBlob for `code`: the bytes that the signature covers, from the first to the last. */
export function signature(code: Uint8Array): Buffer {
  const slots = Math.ceil(code.length / HASH_PAGE);
  const identOffset = CODE_DIRECTORY_SIZE;
  const hashOffset = identOffset + IDENT.length;
  const length = hashOffset + 32 * slots;
  if (code.length >= 2 ** 32) throw new Error("codeLimit is 32 bits here");

  // Every field is big endian. The names are the ones of xnu's osfmk/kern/cs_blobs.h.
  const directory = Buffer.alloc(CODE_DIRECTORY_SIZE);
  let at = 0;
  const u32 = (value: number) => (at = directory.writeUInt32BE(value, at));
  const u8 = (value: number) => (at = directory.writeUInt8(value, at));
  const u64 = (value: number) => (at = directory.writeBigUInt64BE(BigInt(value), at));
  u32(0xfade0c02); // magic
  u32(length);
  u32(0x20400); // version
  u32(0x20002); // flags: adhoc, linker-signed
  u32(hashOffset);
  u32(identOffset);
  u32(0); // special slots
  u32(slots); // code slots
  u32(code.length); // codeLimit
  u8(32); // hash size
  u8(2); // hash type SHA-256
  u8(0); // platform
  u8(12); // log2(hash page)
  u32(0); // spare2
  u32(0); // scatterOffset
  u32(0); // teamOffset
  u32(0); // spare3
  u64(0); // codeLimit64
  u64(0); // execSegBase
  u64(code.length); // execSegLimit
  u64(0); // execSegFlags
  if (at !== CODE_DIRECTORY_SIZE) throw new Error(`the CodeDirectory has ${at} bytes, not ${CODE_DIRECTORY_SIZE}`);

  const hashes: Buffer[] = [];
  for (let page = 0; page < code.length; page += HASH_PAGE) {
    hashes.push(
      createHash("sha256")
        .update(code.subarray(page, page + HASH_PAGE))
        .digest(),
    );
  }
  // SuperBlob: magic, length, count, then (type 0 = CodeDirectory, offset 20).
  const superBlob = Buffer.alloc(20);
  superBlob.writeUInt32BE(0xfade0cc0, 0);
  superBlob.writeUInt32BE(20 + length, 4);
  superBlob.writeUInt32BE(1, 8);
  superBlob.writeUInt32BE(0, 12);
  superBlob.writeUInt32BE(20, 16);
  return Buffer.concat([superBlob, directory, IDENT, ...hashes]);
}

/** Signs the image at `path` in place and returns how many bytes are covered and how long the signature is. */
export function sign(path: string): { covered: number; signature: number } {
  let data = readFileSync(path);
  if (data.length >= TRAILER_SIZE && data.subarray(data.length - 8).equals(MAGIC)) {
    // signed before: sign again
    data = data.subarray(0, Number(data.readBigUInt64LE(data.length - TRAILER_SIZE + 8)));
  }
  const code = Buffer.concat([data, Buffer.alloc((ALIGN - (data.length % ALIGN)) % ALIGN)]);
  const blob = signature(code);
  const trailer = Buffer.alloc(TRAILER_SIZE);
  trailer.writeBigUInt64LE(0n, 0);
  trailer.writeBigUInt64LE(BigInt(code.length), 8);
  trailer.writeBigUInt64LE(BigInt(code.length), 16);
  trailer.writeBigUInt64LE(BigInt(blob.length), 24);
  MAGIC.copy(trailer, 32);
  writeFileSync(path, Buffer.concat([code, blob, trailer]));
  return { covered: code.length, signature: blob.length };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length === 2 && args[0] === "--blob") {
    process.stdout.write(signature(readFileSync(args[1]!)));
  } else if (args.length === 1) {
    const result = sign(args[0]!);
    console.log(`signed ${args[0]}: ${result.covered} bytes covered, signature ${result.signature} bytes`);
  } else {
    process.stderr.write(
      "usage: bun tools/apple_sign.ts <image>          sign in place\n" +
        "       bun tools/apple_sign.ts --blob <file>    print the signature of <file> as it is\n",
    );
    process.exit(1);
  }
}
