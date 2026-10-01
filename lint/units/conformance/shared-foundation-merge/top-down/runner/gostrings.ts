// Go's strings, unicode, strconv and fmt where JavaScript differs, on decoded JavaScript strings and on runes.
import { foldRanges, lowerRanges } from "./unicode_tables";

// unicode.IsSpace: it has U+0085 and lacks U+FEFF, unlike String.prototype.trim.
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

// strings.TrimSpace; every space of Go is one code unit.
export function trimSpace(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && isSpace(s.charCodeAt(start))) start++;
  while (end > start && isSpace(s.charCodeAt(end - 1))) end--;
  return s.slice(start, end);
}

// strings.TrimFunc
export function trimFunc(s: string, f: (r: number) => boolean): string {
  const cps = [...s];
  let start = 0;
  let end = cps.length;
  while (start < end && f(cps[start].codePointAt(0)!)) start++;
  while (end > start && f(cps[end - 1].codePointAt(0)!)) end--;
  return cps.slice(start, end).join("");
}

// strings.TrimSuffix
export function trimSuffix(s: string, suffix: string): string {
  return s.endsWith(suffix) ? s.slice(0, s.length - suffix.length) : s;
}

// A table holds first, last, stride and difference of each run; the runs are in order.
function mapped(table: readonly number[], r: number): number {
  let low = 0;
  let high = table.length / 4 - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const at = middle * 4;
    if (r < table[at]) high = middle - 1;
    else if (r > table[at + 1]) low = middle + 1;
    else return (r - table[at]) % table[at + 2] === 0 ? r + table[at + 3] : r;
  }
  return r;
}

// unicode.ToLower at the Unicode version of the reference's toolchain.
export function unicodeToLower(r: number): number {
  if (r < 0x80) return r >= 0x41 && r <= 0x5a ? r + 0x20 : r;
  return mapped(lowerRanges, r);
}

// Two runes are equal under unicode.SimpleFold when their keys are equal.
export function foldKey(r: number): number {
  if (r < 0x80) return r >= 0x61 && r <= 0x7a ? r - 0x20 : r;
  return mapped(foldRanges, r);
}

export function isAscii(s: string): boolean {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) >= 0x80) return false;
  return true;
}

// strings.ToLower: one code point at a time, so U+0130 lowers to "i" and no final sigma rule applies.
export function toLower(s: string): string {
  if (isAscii(s)) return s.toLowerCase();
  let out = "";
  for (const ch of s) out += String.fromCodePoint(unicodeToLower(ch.codePointAt(0)!));
  return out;
}

// strings.EqualFold
export function equalFold(a: string, b: string): boolean {
  if (a === b) return true;
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const x = a.codePointAt(i)!;
    const y = b.codePointAt(j)!;
    if (x !== y && foldKey(x) !== foldKey(y)) return false;
    i += x > 0xffff ? 2 : 1;
    j += y > 0xffff ? 2 : 1;
  }
  return i === a.length && j === b.length;
}

// strings.Compare: the byte order of UTF-8, which differs from the order of code units above the BMP.
export function compareStrings(a: string, b: string): -1 | 0 | 1 {
  if (a === b) return 0;
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

// slices.Sorted of strings
export function sortedStrings(values: Iterable<string>): string[] {
  return [...values].sort(compareStrings);
}

// strconv.Atoi: an optional sign and decimal digits in the range of int64; undefined stands for the error.
export function atoi(s: string): number | undefined {
  if (!/^[+-]?[0-9]+$/.test(s)) return undefined;
  const n = BigInt(s);
  if (n < -(2n ** 63n) || n > 2n ** 63n - 1n) return undefined;
  return Number(n);
}

// fmt "%*s" and "%*d": right-aligned in a field of the given width, padded with spaces.
export function padLeft(s: string, width: number): string {
  return s.length >= width ? s : " ".repeat(width - s.length) + s;
}
