import { readFileSync } from "node:fs";

export interface ReadFileResult {
  contents: string;
  ok: boolean;
  // True when the bytes were not valid UTF-8 and U+FFFD was substituted.
  lossy: boolean;
}

const utf8Fatal = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

// Port of Common.ReadFile in internal/vfs/internal/internal.go.
export function readFile(path: string): ReadFileResult {
  let b: Uint8Array;
  try {
    b = readFileSync(path);
  } catch {
    return { contents: "", ok: false, lossy: false };
  }
  if (b.length === 0) {
    return { contents: "", ok: true, lossy: false };
  }
  return decodeBytes(b);
}

// Port of decodeBytes: UTF-16 by BOM, then one UTF-8 BOM is dropped.
export function decodeBytes(s: Uint8Array): ReadFileResult {
  if (s.length >= 2) {
    if (s[0] === 0xff && s[1] === 0xfe) {
      return { contents: decodeUtf16(s.subarray(2), true), ok: true, lossy: false };
    }
    if (s[0] === 0xfe && s[1] === 0xff) {
      return { contents: decodeUtf16(s.subarray(2), false), ok: true, lossy: false };
    }
  }
  if (s.length >= 3 && s[0] === 0xef && s[1] === 0xbb && s[2] === 0xbf) {
    s = s.subarray(3);
  }
  try {
    return { contents: utf8Fatal.decode(s), ok: true, lossy: false };
  } catch {
    return { contents: Buffer.from(s.buffer, s.byteOffset, s.byteLength).toString("utf8"), ok: true, lossy: true };
  }
}

// Port of decodeUtf16: an odd trailing byte is ignored, a lone surrogate becomes U+FFFD.
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
