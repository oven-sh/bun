import { isLineBreak, isWhiteSpaceLike } from "./stringutil";

const runeError = 0xfffd;

// Port of utf8.DecodeRune: returns the rune and its width, U+FFFD and 1 on bad input.
export function decodeRune(text: Uint8Array, pos: number): [number, number] {
  const n = text.length - pos;
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

// Port of utf8.DecodeLastRune on text[0:end].
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
  const [rune, size] = decodeRune(text.subarray(0, end), start);
  if (start + size !== end) return [runeError, 1];
  return [rune, size];
}

const mergeConflictMarkerLength = 7;
const maxAsciiCharacter = 127;

// Port of scanner.SkipTrivia with no options, on UTF-8 bytes as the reference.
export function skipTrivia(text: Uint8Array, pos: number): number {
  if (pos < 0) return pos;
  const textLen = text.length;
  for (;;) {
    if (pos >= textLen) return pos;
    const [ch, size] = decodeRune(text, pos);
    switch (ch) {
      case 0x0d:
        if (pos + 1 < textLen && text[pos + 1] === 0x0a) pos++;
        pos++;
        continue;
      case 0x0a:
        pos++;
        continue;
      case 0x09:
      case 0x0b:
      case 0x0c:
      case 0x20:
        pos++;
        continue;
      case 0x2f:
        if (pos + 1 < textLen) {
          if (text[pos + 1] === 0x2f) {
            pos += 2;
            while (pos < textLen) {
              const [c, s] = decodeRune(text, pos);
              if (isLineBreak(c)) break;
              pos += s;
            }
            continue;
          }
          if (text[pos + 1] === 0x2a) {
            pos += 2;
            while (pos < textLen) {
              if (text[pos] === 0x2a && pos + 1 < textLen && text[pos + 1] === 0x2f) {
                pos += 2;
                break;
              }
              pos += decodeRune(text, pos)[1];
            }
            continue;
          }
        }
        break;
      case 0x3c:
      case 0x7c:
      case 0x3d:
      case 0x3e:
        if (isConflictMarkerTrivia(text, pos)) {
          pos = scanConflictMarkerTrivia(text, pos);
          continue;
        }
        break;
      case 0x23:
        if (pos === 0 && isShebangTrivia(text)) {
          pos = scanShebangTrivia(text, pos);
          continue;
        }
        break;
      default:
        if (ch > maxAsciiCharacter && isWhiteSpaceLike(ch)) {
          pos += size;
          continue;
        }
    }
    return pos;
  }
}

function isConflictMarkerTrivia(text: Uint8Array, pos: number): boolean {
  if (pos + 1 >= text.length || text[pos + 1] !== text[pos]) return false;
  let atLineStart = pos === 0 || isLineBreak(text[pos - 1]);
  if (!atLineStart && pos >= 2) {
    atLineStart = isLineBreak(decodeLastRune(text, pos - 2)[0]);
  }
  if (atLineStart) {
    const ch = text[pos];
    if (pos + mergeConflictMarkerLength < text.length) {
      for (let i = 0; i < mergeConflictMarkerLength; i++) {
        if (text[pos + i] !== ch) return false;
      }
      return ch === 0x3d || text[pos + mergeConflictMarkerLength] === 0x20;
    }
  }
  return false;
}

function scanConflictMarkerTrivia(text: Uint8Array, pos: number): number {
  let [ch, size] = decodeRune(text, pos);
  const length = text.length;
  if (ch === 0x3c || ch === 0x3e) {
    while (pos < length && !isLineBreak(ch)) {
      pos += size;
      [ch, size] = decodeRune(text, pos);
    }
  } else {
    while (pos < length) {
      const currentChar = text[pos];
      if ((currentChar === 0x3d || currentChar === 0x3e) && currentChar !== ch && isConflictMarkerTrivia(text, pos)) {
        break;
      }
      pos++;
    }
  }
  return pos;
}

function isShebangTrivia(text: Uint8Array): boolean {
  if (text.length < 2) return false;
  return text[0] === 0x23 && text[1] === 0x21;
}

function scanShebangTrivia(text: Uint8Array, pos: number): number {
  pos += 2;
  while (pos < text.length) {
    const [ch, size] = decodeRune(text, pos);
    if (isLineBreak(ch)) break;
    pos += size;
  }
  return pos;
}
