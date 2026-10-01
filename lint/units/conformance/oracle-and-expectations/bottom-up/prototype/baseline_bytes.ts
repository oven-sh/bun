// Prototype: the list reader on bytes, as Go sees the file; a key is a string of char codes 0 to 255.
const RuneError = 0xfffd;

// utf8.DecodeRuneInString at i: [rune, size]; an invalid or short sequence is [RuneError, 1]
function decodeRune(s: string, i: number): [number, number] {
  const n = s.length - i;
  if (n < 1) return [RuneError, 0];
  const b0 = s.charCodeAt(i);
  if (b0 < 0x80) return [b0, 1];
  let size = 0, lo = 0x80, hi = 0xbf;
  if (b0 >= 0xc2 && b0 <= 0xdf) size = 2;
  else if (b0 === 0xe0) (size = 3), (lo = 0xa0);
  else if ((b0 >= 0xe1 && b0 <= 0xec) || b0 === 0xee || b0 === 0xef) size = 3;
  else if (b0 === 0xed) (size = 3), (hi = 0x9f);
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

// utf8.DecodeLastRuneInString of s[0:end]
function decodeLastRune(s: string, end: number): [number, number] {
  if (end === 0) return [RuneError, 0];
  let start = end - 1;
  const r = s.charCodeAt(start);
  if (r < 0x80) return [r, 1];
  const lim = Math.max(0, end - 4);
  for (start--; start >= lim; start--) {
    if ((s.charCodeAt(start) & 0xc0) !== 0x80) break;
  }
  if (start < 0) start = 0;
  const [rune, size] = decodeRune(s.slice(0, end), start);
  if (start + size !== end) return [RuneError, 1];
  return [rune, size];
}

function isSpace(r: number): boolean {
  switch (r) {
    case 0x09: case 0x0a: case 0x0b: case 0x0c: case 0x0d: case 0x20: case 0x85: case 0xa0:
    case 0x1680: case 0x2028: case 0x2029: case 0x202f: case 0x205f: case 0x3000:
      return true;
  }
  return r >= 0x2000 && r <= 0x200a;
}

export function trimSpaceBytes(s: string): string {
  let start = 0;
  while (start < s.length) {
    const [r, size] = decodeRune(s, start);
    if (!isSpace(r)) break;
    start += size;
  }
  let end = s.length;
  while (end > start) {
    const [r, size] = decodeLastRune(s.slice(start), end - start);
    if (!isSpace(r)) break;
    end -= size;
  }
  return s.slice(start, end);
}

export function parseFileNameSetBytes(content: Uint8Array): Set<string> {
  const set = new Set<string>();
  for (let line of Buffer.from(content).toString("latin1").split("\n")) {
    line = trimSpaceBytes(line);
    if (line === "" || line.charCodeAt(0) === 0x23) continue;
    set.add(line);
  }
  return set;
}
