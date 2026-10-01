import { readFileSync } from "node:fs";
import type { Result } from "./result";

const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

// Port of Common.ReadFile in internal/vfs/internal/internal.go.
export function readFile(path: string): Result<string> {
  let b: Uint8Array;
  try {
    b = readFileSync(path);
  } catch {
    return { ok: false, reason: "cannot read " + path };
  }
  if (b.length === 0) {
    return { ok: true, value: "" };
  }
  return decodeBytes(b);
}

// Port of decodeBytes: UTF-16 by byte order mark, else one UTF-8 byte order mark is dropped.
export function decodeBytes(s: Uint8Array): Result<string> {
  if (s.length >= 2) {
    if (s[0] === 0xff && s[1] === 0xfe) {
      return { ok: true, value: decodeUtf16(s.subarray(2), true) };
    }
    if (s[0] === 0xfe && s[1] === 0xff) {
      return { ok: true, value: decodeUtf16(s.subarray(2), false) };
    }
  }
  if (s.length >= 3 && s[0] === 0xef && s[1] === 0xbb && s[2] === 0xbf) {
    s = s.subarray(3);
  }
  try {
    return { ok: true, value: utf8.decode(s) };
  } catch {
    // The reference keeps the raw bytes of such a file, which a string cannot hold.
    return { ok: false, reason: "not valid UTF-8" };
  }
}

// Port of decodeUtf16: an odd trailing byte is ignored and a lone surrogate becomes U+FFFD.
export function decodeUtf16(s: Uint8Array, littleEndian: boolean): string {
  const count = s.length >> 1;
  const view = new DataView(s.buffer, s.byteOffset, count * 2);
  const parts: string[] = [];
  const chunk = 8192;
  for (let start = 0; start < count; start += chunk) {
    const end = Math.min(count, start + chunk);
    const units = new Array<number>(end - start);
    for (let i = start; i < end; i++) {
      units[i - start] = view.getUint16(i * 2, littleEndian);
    }
    parts.push(String.fromCharCode.apply(null, units));
  }
  return parts.join("").toWellFormed();
}
