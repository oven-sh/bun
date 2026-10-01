import { decodeLastRune, decodeRune } from "./go_utf8";
import { isLineBreak, isWhiteSpaceLike } from "./stringutil";

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
