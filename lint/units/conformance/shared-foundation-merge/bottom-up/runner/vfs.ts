// Port of ReadFile, decodeBytes and decodeUtf16 of internal/vfs/internal/internal.go of typescript-go 89d5d5b.
import { readFileSync } from "node:fs";
import { utf8Bytes, utf8String } from "./gostrings";

export type ReadFileResult = { ok: true; contents: string } | { ok: false };

// The text of a file as the reference reads it. Bytes that are not UTF-8 throw InvalidUtf8Error: nothing is replaced.
export function readFile(path: string): ReadFileResult {
  let b: Uint8Array;
  try {
    b = readFileSync(path);
  } catch {
    return { ok: false };
  }
  if (b.length === 0) return { ok: true, contents: "" };
  return { ok: true, contents: utf8String(decodeBytes(b), path) };
}

// The UTF-8 bytes of the contents: UTF-16 by its byte order mark, else one UTF-8 byte order mark is dropped.
export function decodeBytes(s: Uint8Array): Uint8Array {
  if (s.length >= 2) {
    if (s[0] === 0xff && s[1] === 0xfe) return utf8Bytes(decodeUtf16(s.subarray(2), true));
    if (s[0] === 0xfe && s[1] === 0xff) return utf8Bytes(decodeUtf16(s.subarray(2), false));
  }
  if (s.length >= 3 && s[0] === 0xef && s[1] === 0xbb && s[2] === 0xbf) return s.subarray(3);
  return s;
}

// An odd last byte is ignored and a lone surrogate becomes U+FFFD, as utf16.Decode does.
export function decodeUtf16(s: Uint8Array, littleEndian: boolean): string {
  const count = s.length >> 1;
  const view = new DataView(s.buffer, s.byteOffset, count * 2);
  const parts: string[] = [];
  const chunk = 8192;
  for (let start = 0; start < count; start += chunk) {
    const end = Math.min(count, start + chunk);
    const units = new Array<number>(end - start);
    for (let i = start; i < end; i++) units[i - start] = view.getUint16(i * 2, littleEndian);
    parts.push(String.fromCharCode.apply(null, units));
  }
  return parts.join("").toWellFormed();
}
