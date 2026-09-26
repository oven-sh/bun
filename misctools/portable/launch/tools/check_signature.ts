// Checks the ad-hoc Apple code signature of an image.
//
//   bun tools/check_signature.ts <file>       a packed container or a bare image
//
// What misctools/portable/test/check_signature.ts checks, for a bare image and
// for a packed container. It reads the file the
// way the macOS stub does, then the signature field by field (xnu
// osfmk/kern/cs_blobs.h), and hashes every page itself. It does not use the
// code that wrote the signature. It cannot tell whether macOS accepts the
// signature: that needs a Mac.
//
// Two forms are read, the two the macOS stub reads:
//   - a bare image signed by misctools/portable/tools/apple_sign.ts: the last
//     40 bytes are 5 x u64, code_off (0), code_len, sig_off, sig_len,
//     "BUNSIG01", and the image is the file.
//   - a packed container (tools/pack.ts): the last 128 bytes are the BUNPACK1
//     table of contents, the image lies image_off bytes into the file and the
//     signed range starts there, not at 0.
import { createHash } from "node:crypto";
import { decodeToc } from "./format.ts";

export const IDENT = "bun.portable.image\0";
const HASH_PAGE = 4096;
const APPLE_PAGE = 16384;

export type SignatureCheck = { ok: boolean; what: string; detail?: string };

export type Where = {
  form: "container" | "bare image";
  imageOff: number;
  codeOff: number;
  codeLen: number;
  sigOff: number;
  sigLen: number;
};

/** Where the image and its signature are, read from the end of the file. */
export function placeOf(file: Buffer): Where | null {
  const toc = decodeToc(file);
  if (toc) {
    return {
      form: "container",
      imageOff: toc.imageOff,
      codeOff: toc.codeOff,
      codeLen: toc.codeLen,
      sigOff: toc.sigOff,
      sigLen: toc.sigLen,
    };
  }
  if (file.length < 40) return null;
  const t = file.subarray(file.length - 40);
  if (t.toString("latin1", 32, 40) !== "BUNSIG01") return null;
  const n = (i: number) => Number(t.readBigUInt64LE(8 * i));
  return { form: "bare image", imageOff: 0, codeOff: n(0), codeLen: n(1), sigOff: n(2), sigLen: n(3) };
}

export function checkSignature(file: Buffer): { checks: SignatureCheck[]; where: Where | null } {
  const checks: SignatureCheck[] = [];
  const ok = (cond: boolean, what: string, detail?: string) => checks.push({ ok: !!cond, what, detail });
  const where = placeOf(file);
  if (!where) {
    ok(false, "the file ends with a BUNPACK1 table of contents or a BUNSIG01 trailer");
    return { checks, where };
  }
  if (!where.sigLen) {
    ok(false, "the file carries a code signature", `${where.form}, sig_len 0`);
    return { checks, where };
  }
  const tail = where.form === "bare image" ? 40 : 128;
  ok(
    where.codeOff === where.imageOff,
    "the signed range starts where the image starts",
    `code_off 0x${where.codeOff.toString(16)}`,
  );
  ok(where.codeOff % APPLE_PAGE === 0 && where.codeLen % APPLE_PAGE === 0, "the signed range is whole 16 KiB pages");
  ok(where.sigOff === where.codeOff + where.codeLen, "the signature follows the signed range");
  ok(where.sigOff + where.sigLen + tail <= file.length, "the signature and the trailer are the end of the file");

  const blob = file.subarray(where.sigOff, where.sigOff + where.sigLen);
  const sb = [0, 4, 8, 12, 16].map(at => blob.readUInt32BE(at));
  ok(
    sb[0] === 0xfade0cc0 && sb[1] === where.sigLen && sb[2] === 1 && sb[3] === 0 && sb[4] === 20,
    "SuperBlob header: one CodeDirectory at offset 20",
    sb.map(v => `0x${v.toString(16)}`).join(" "),
  );
  const cd = blob.subarray(20);
  const u32 = (at: number) => cd.readUInt32BE(at);
  const u64 = (at: number) => cd.readBigUInt64BE(at);
  const hashOffset = u32(16);
  const identOffset = u32(20);
  const codeSlots = u32(28);
  ok(u32(0) === 0xfade0c02 && u32(4) === cd.length, "CodeDirectory magic and length");
  ok(u32(8) === 0x20400 && u32(12) === 0x20002, "version 0x20400, flags 0x20002 (adhoc, linker-signed)");
  ok(cd[36] === 32 && cd[37] === 2 && cd[39] === 12, "SHA-256 over 4 KiB pages");
  ok(
    u32(24) === 0 && codeSlots === where.codeLen / HASH_PAGE && u32(32) === where.codeLen,
    "no special slots, one slot per page, codeLimit is the range",
  );
  ok(
    cd[38] === 0 && u32(40) === 0 && u32(44) === 0 && u32(48) === 0 && u32(52) === 0 && u64(56) === 0n,
    "the fields that have to be 0",
  );
  ok(
    u64(64) === 0n && u64(72) === BigInt(where.codeLen) && u64(80) === 0n,
    "execSegBase 0, execSegLimit the range, execSegFlags 0",
  );
  ok(cd.toString("latin1", identOffset, hashOffset) === IDENT, "the identifier is bun.portable.image");
  ok(hashOffset + 32 * codeSlots === cd.length, "the hash table is the rest of the CodeDirectory");
  let bad = -1;
  for (let i = 0; i < codeSlots && bad < 0; i++) {
    const page = file.subarray(where.codeOff + i * HASH_PAGE, where.codeOff + (i + 1) * HASH_PAGE);
    if (
      !createHash("sha256")
        .update(page)
        .digest()
        .equals(cd.subarray(hashOffset + 32 * i, hashOffset + 32 * (i + 1)))
    )
      bad = i;
  }
  ok(
    bad < 0,
    `the hash of every one of the ${codeSlots} pages matches the file`,
    bad < 0 ? undefined : `page ${bad} differs`,
  );

  // What a host maps from the file has to lie inside the signed range.
  const image = file.subarray(where.imageOff);
  ok(image.toString("latin1", 0, 4) === "\x7fELF", "the image is an ELF file");
  const phoff = Number(image.readBigUInt64LE(32));
  const phentsize = image.readUInt16LE(54);
  const phnum = image.readUInt16LE(56);
  let mapped = 0;
  let outside = -1;
  for (let i = 0; i < phnum; i++) {
    const at = phoff + i * phentsize;
    if (image.readUInt32LE(at) !== 1) continue;
    const flags = image.readUInt32LE(at + 4);
    if (flags & 2) continue; // writable segments are copied, not mapped
    const offset = where.imageOff + Number(image.readBigUInt64LE(at + 8));
    const memsz = Number(image.readBigUInt64LE(at + 40));
    const end = offset + Math.ceil(memsz / APPLE_PAGE) * APPLE_PAGE;
    if (offset % APPLE_PAGE || end > where.codeOff + where.codeLen) outside = i;
    mapped++;
  }
  ok(mapped > 0, "the image has segments that are mapped from the file");
  ok(
    outside < 0,
    "every mapped segment is 16 KiB aligned and inside the signed range",
    outside < 0 ? undefined : `segment ${outside}`,
  );
  return { checks, where };
}

if (import.meta.main) {
  const path = process.argv[2];
  if (!path) throw new Error("usage: bun tools/check_signature.ts <file>");
  const file = Buffer.from(await Bun.file(path).arrayBuffer());
  const { checks, where } = checkSignature(file);
  for (const c of checks) console.log(`${c.ok ? "ok  " : "FAIL"} ${c.what}${c.detail ? `  [${c.detail}]` : ""}`);
  const failed = checks.filter(c => !c.ok).length;
  if (where) {
    console.log(
      `${path}: ${where.form}, signature covers ${where.codeLen} bytes from 0x${where.codeOff.toString(16)} ` +
        `in ${where.codeLen / HASH_PAGE} pages, blob 0x${where.sigOff.toString(16)} + ${where.sigLen}`,
    );
  }
  console.log(`${path}: ${checks.length - failed} of ${checks.length} signature checks passed`);
  if (failed) process.exit(1);
}
