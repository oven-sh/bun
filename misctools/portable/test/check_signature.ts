/**
 * Checks the Apple code signature that tools/apple_sign.ts appended to an image.
 *
 *   bun test/check_signature.ts <image>
 *
 * Reads the file the way the macOS host does (trailer at the end), then the
 * signature field by field (xnu osfmk/kern/cs_blobs.h), and hashes every page.
 * It does not use the code of apple_sign.ts. It cannot tell whether macOS
 * accepts the signature: that needs a Mac.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/** What is wrong with the signature of an image. The message starts with the path of the image. */
export class SignatureError extends Error {}

/** Checks the image at `path` and returns the line that says what was checked. Throws SignatureError. */
export function checkSignature(path: string): string {
  const data = readFileSync(path);
  const need = (condition: boolean, what: string) => {
    if (!condition) throw new SignatureError(`${path}: ${what}`);
  };

  need(data.length >= 40, "no trailer");
  const trailer = data.subarray(data.length - 40);
  const codeOff = trailer.readBigUInt64LE(0);
  const codeLen = trailer.readBigUInt64LE(8);
  const sigOff = trailer.readBigUInt64LE(16);
  const sigLen = trailer.readBigUInt64LE(24);
  need(trailer.subarray(32).equals(Buffer.from("BUNSIG01", "latin1")), "no trailer");
  need(codeOff === 0n && codeLen % 16384n === 0n, "the signed range is not whole 16 KiB pages from offset 0");
  need(
    sigOff === codeLen && sigOff + sigLen + 40n === BigInt(data.length),
    "signature and trailer do not follow the signed range",
  );
  const blob = data.subarray(Number(sigOff), Number(sigOff + sigLen));

  const superBlob = [0, 4, 8, 12, 16].map(at => blob.readUInt32BE(at));
  need(superBlob.join() === [0xfade0cc0, Number(sigLen), 1, 0, 20].join(), "SuperBlob header");
  const cd = blob.subarray(20);
  let at = 0;
  const u32 = () => cd.readUInt32BE((at += 4) - 4);
  const u8 = () => cd.readUInt8((at += 1) - 1);
  const u64 = () => cd.readBigUInt64BE((at += 8) - 8);
  const magic = u32();
  const length = u32();
  const version = u32();
  const flags = u32();
  const hashOffset = u32();
  const identOffset = u32();
  const specialSlots = u32();
  const codeSlots = u32();
  const codeLimit = u32();
  const hashSize = u8();
  const hashType = u8();
  const platform = u8();
  const pageLog2 = u8();
  const spare2 = u32();
  const scatter = u32();
  const team = u32();
  const spare3 = u32();
  const codeLimit64 = u64();
  const execBase = u64();
  const execLimit = u64();
  const execFlags = u64();
  need(magic === 0xfade0c02 && length === cd.length, "CodeDirectory magic or length");
  need(version === 0x20400 && flags === 0x20002, "version or flags");
  need(hashSize === 32 && hashType === 2 && pageLog2 === 12, "not SHA-256 over 4 KiB pages");
  need(
    specialSlots === 0 && BigInt(codeSlots) === codeLen / 4096n && BigInt(codeLimit) === codeLen,
    "slots or codeLimit",
  );
  need(
    platform === 0 && spare2 === 0 && scatter === 0 && team === 0 && spare3 === 0 && codeLimit64 === 0n,
    "a field that has to be 0",
  );
  need(execBase === 0n && execLimit === codeLen && execFlags === 0n, "execSeg fields");
  need(cd.subarray(identOffset, hashOffset).equals(Buffer.from("bun.portable.image\0", "latin1")), "identifier");
  need(hashOffset + 32 * codeSlots === cd.length, "size of the hash table");
  for (let i = 0; i < codeSlots; i++) {
    const hash = createHash("sha256")
      .update(data.subarray(4096 * i, 4096 * (i + 1)))
      .digest();
    need(hash.equals(cd.subarray(hashOffset + 32 * i, hashOffset + 32 * (i + 1))), `hash of page ${i}`);
  }

  // What the host maps from the file has to be inside the signed range.
  need(data.subarray(0, 4).equals(Buffer.from("\x7fELF", "latin1")), "not an ELF file");
  const phoff = Number(data.readBigUInt64LE(32));
  const phentsize = data.readUInt16LE(54);
  const phnum = data.readUInt16LE(56);
  let mapped = 0;
  for (let i = 0; i < phnum; i++) {
    const header = phoff + i * phentsize;
    const type = data.readUInt32LE(header);
    const segmentFlags = data.readUInt32LE(header + 4);
    const offset = data.readBigUInt64LE(header + 8);
    const memsz = data.readBigUInt64LE(header + 40);
    if (type === 1 && !(segmentFlags & 2)) {
      const end = offset + ((memsz + 16383n) & ~16383n);
      need(offset % 16384n === 0n && end <= codeLen, `segment ${i} leaves the signed range`);
      mapped++;
    }
  }
  return `${path}: signature covers ${codeLen} bytes in ${codeSlots} pages, all hashes match, ${mapped} mapped segments are inside`;
}

if (import.meta.main) {
  const [path] = process.argv.slice(2);
  if (path === undefined) {
    process.stderr.write("usage: bun test/check_signature.ts <image>\n");
    process.exit(2);
  }
  try {
    console.log(checkSignature(path));
  } catch (error) {
    if (!(error instanceof SignatureError)) throw error;
    process.stderr.write(error.message + "\n");
    process.exit(1);
  }
}
