// Byte-level helpers with the semantics of the Go standard library functions that the reference calls.
// A ByteString is a JavaScript string whose char codes are bytes (latin1 view of UTF-8 text).

export type ByteString = string;

export const RuneError = 0xfffd;
const RuneSelf = 0x80;
const UTFMax = 4;

export function toByteString(bytes: Uint8Array): ByteString {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
}

export function fromByteString(s: ByteString): Buffer {
  return Buffer.from(s, "latin1");
}

export function utf8ToByteString(s: string): ByteString {
  return Buffer.from(s, "utf8").toString("latin1");
}

export function byteStringToUtf8(s: ByteString): string {
  return Buffer.from(s, "latin1").toString("utf8");
}

// utf8.DecodeRuneInString at index i: returns [rune, size]; an invalid or short sequence is [RuneError, 1].
export function decodeRune(s: ByteString, i: number, end: number = s.length): [number, number] {
  const n = end - i;
  if (n < 1) return [RuneError, 0];
  const b0 = s.charCodeAt(i);
  if (b0 < RuneSelf) return [b0, 1];
  let size = 0;
  let lo = 0x80;
  let hi = 0xbf;
  if (b0 >= 0xc2 && b0 <= 0xdf) size = 2;
  else if (b0 === 0xe0) (size = 3), (lo = 0xa0);
  else if (b0 >= 0xe1 && b0 <= 0xec) size = 3;
  else if (b0 === 0xed) (size = 3), (hi = 0x9f);
  else if (b0 >= 0xee && b0 <= 0xef) size = 3;
  else if (b0 === 0xf0) (size = 4), (lo = 0x90);
  else if (b0 >= 0xf1 && b0 <= 0xf3) size = 4;
  else if (b0 === 0xf4) (size = 4), (hi = 0x8f);
  else return [RuneError, 1];
  if (n < size) return [RuneError, 1];
  const b1 = s.charCodeAt(i + 1);
  if (b1 < lo || b1 > hi) return [RuneError, 1];
  if (size === 2) return [((b0 & 0x1f) << 6) | (b1 & 0x3f), 2];
  const b2 = s.charCodeAt(i + 2);
  if (b2 < 0x80 || b2 > 0xbf) return [RuneError, 1];
  if (size === 3) return [((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f), 3];
  const b3 = s.charCodeAt(i + 3);
  if (b3 < 0x80 || b3 > 0xbf) return [RuneError, 1];
  return [((b0 & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f), 4];
}

// utf8.DecodeLastRuneInString of s[start:end].
export function decodeLastRune(s: ByteString, begin: number, end: number): [number, number] {
  if (end - begin === 0) return [RuneError, 0];
  let start = end - 1;
  const r = s.charCodeAt(start);
  if (r < RuneSelf) return [r, 1];
  let lim = end - UTFMax;
  if (lim < begin) lim = begin;
  for (start--; start >= lim; start--) {
    if ((s.charCodeAt(start) & 0xc0) !== 0x80) break;
  }
  if (start < begin) start = begin;
  const [rr, size] = decodeRune(s, start, end);
  if (start + size !== end) return [RuneError, 1];
  return [rr, size];
}

// utf8.RuneCountInString
export function runeCount(s: ByteString): number {
  let n = 0;
  for (let i = 0; i < s.length; ) {
    const c = s.charCodeAt(i);
    if (c < RuneSelf) {
      i++;
    } else {
      i += decodeRune(s, i)[1];
    }
    n++;
  }
  return n;
}

// core.UTF16Len: the number of UTF-16 code units of the UTF-8 text.
export function utf16Len(s: ByteString): number {
  let n = 0;
  for (let i = 0; i < s.length; ) {
    const c = s.charCodeAt(i);
    if (c < RuneSelf) {
      i++;
      n++;
    } else {
      const [r, size] = decodeRune(s, i);
      i += size;
      n += r >= 0x10000 ? 2 : 1;
    }
  }
  return n;
}

// unicode.IsSpace
export function isSpace(r: number): boolean {
  switch (r) {
    case 0x09:
    case 0x0a:
    case 0x0b:
    case 0x0c:
    case 0x0d:
    case 0x20:
    case 0x85:
    case 0xa0:
    case 0x1680:
    case 0x2028:
    case 0x2029:
    case 0x202f:
    case 0x205f:
    case 0x3000:
      return true;
  }
  return r >= 0x2000 && r <= 0x200a;
}

// strings.TrimRightFunc(s, unicode.IsSpace)
export function trimRightSpace(s: ByteString): ByteString {
  let end = s.length;
  while (end > 0) {
    const [r, size] = decodeLastRune(s, 0, end);
    if (!isSpace(r)) break;
    end -= size;
  }
  return s.slice(0, end);
}

// regexp `\S` ReplaceAllString(s, " "): RE2's \s is [\t\n\f\r ]; every other rune becomes one space.
export function replaceNonWhitespace(s: ByteString): ByteString {
  let out = "";
  for (let i = 0; i < s.length; ) {
    const c = s.charCodeAt(i);
    if (c < RuneSelf) {
      out += c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d || c === 0x20 ? s[i] : " ";
      i++;
    } else {
      i += decodeRune(s, i)[1];
      out += " ";
    }
  }
  return out;
}

// fmt "%*s" and "%*d": right-aligned in a field of the given width, padded with spaces.
export function padLeft(s: string, width: number): string {
  return s.length >= width ? s : " ".repeat(width - s.length) + s;
}

// strings.Compare on byte strings.
export function compareStrings(a: ByteString, b: ByteString): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
