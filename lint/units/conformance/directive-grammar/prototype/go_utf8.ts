// Go's utf8.DecodeRune and utf8.DecodeLastRune on bytes: [rune, width], U+FFFD with width 1 on bad input.

const runeError = 0xfffd;

export function decodeRune(text: Uint8Array, pos: number, end: number = text.length): [number, number] {
  const n = end - pos;
  if (n < 1) return [runeError, 0];
  const b0 = text[pos];
  if (b0 < 0x80) return [b0, 1];
  if (b0 < 0xc2 || b0 > 0xf4) return [runeError, 1];
  if (b0 < 0xe0) {
    if (n < 2) return [runeError, 1];
    const b1 = text[pos + 1];
    if (b1 < 0x80 || b1 > 0xbf) return [runeError, 1];
    return [((b0 & 0x1f) << 6) | (b1 & 0x3f), 2];
  }
  if (b0 < 0xf0) {
    if (n < 3) return [runeError, 1];
    const b1 = text[pos + 1];
    const b2 = text[pos + 2];
    const lo = b0 === 0xe0 ? 0xa0 : 0x80;
    const hi = b0 === 0xed ? 0x9f : 0xbf;
    if (b1 < lo || b1 > hi || b2 < 0x80 || b2 > 0xbf) return [runeError, 1];
    return [((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f), 3];
  }
  if (n < 4) return [runeError, 1];
  const b1 = text[pos + 1];
  const b2 = text[pos + 2];
  const b3 = text[pos + 3];
  const lo = b0 === 0xf0 ? 0x90 : 0x80;
  const hi = b0 === 0xf4 ? 0x8f : 0xbf;
  if (b1 < lo || b1 > hi || b2 < 0x80 || b2 > 0xbf || b3 < 0x80 || b3 > 0xbf) return [runeError, 1];
  return [((b0 & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f), 4];
}

export function decodeLastRune(text: Uint8Array, end: number): [number, number] {
  if (end <= 0) return [runeError, 0];
  let start = end - 1;
  const r = text[start];
  if (r < 0x80) return [r, 1];
  const lim = Math.max(end - 4, 0);
  for (start--; start >= lim; start--) {
    if ((text[start] & 0xc0) !== 0x80) break;
  }
  if (start < 0) start = 0;
  const [rune, size] = decodeRune(text, start, end);
  if (start + size !== end) return [runeError, 1];
  return [rune, size];
}
