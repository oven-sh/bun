// Port of internal/scanner/scanner.go of microsoft/typescript-go at 89d5d5b: SkipTrivia without options and ComputeLineOfPosition.
import { type ByteString, decodeLastRune, decodeRune } from "./bytestring";
import { isLineBreak, isWhiteSpaceLike } from "./stringutil";

const mergeConflictMarkerLength = 7;
const maxAsciiCharacter = 127;

export function skipTrivia(text: ByteString, pos: number): number {
  if (pos < 0) return pos;
  const textLen = text.length;
  for (;;) {
    if (pos >= textLen) return pos;
    const [ch, size] = decodeRune(text, pos);
    switch (ch) {
      case 0x0d:
        if (pos + 1 < textLen && text.charCodeAt(pos + 1) === 0x0a) pos++;
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
          if (text.charCodeAt(pos + 1) === 0x2f) {
            pos += 2;
            while (pos < textLen) {
              const [c, s] = decodeRune(text, pos);
              if (isLineBreak(c)) break;
              pos += s;
            }
            continue;
          }
          if (text.charCodeAt(pos + 1) === 0x2a) {
            pos += 2;
            while (pos < textLen) {
              if (text.charCodeAt(pos) === 0x2a && pos + 1 < textLen && text.charCodeAt(pos + 1) === 0x2f) {
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

function isConflictMarkerTrivia(text: ByteString, pos: number): boolean {
  if (pos + 1 >= text.length || text.charCodeAt(pos + 1) !== text.charCodeAt(pos)) return false;
  let atLineStart = pos === 0 || isLineBreak(text.charCodeAt(pos - 1));
  if (!atLineStart && pos >= 2) {
    atLineStart = isLineBreak(decodeLastRune(text, 0, pos - 2)[0]);
  }
  if (atLineStart) {
    const ch = text.charCodeAt(pos);
    if (pos + mergeConflictMarkerLength < text.length) {
      for (let i = 0; i < mergeConflictMarkerLength; i++) {
        if (text.charCodeAt(pos + i) !== ch) return false;
      }
      return ch === 0x3d || text.charCodeAt(pos + mergeConflictMarkerLength) === 0x20;
    }
  }
  return false;
}

function scanConflictMarkerTrivia(text: ByteString, pos: number): number {
  let [ch, size] = decodeRune(text, pos);
  const length = text.length;
  if (ch === 0x3c || ch === 0x3e) {
    while (pos < length && !isLineBreak(ch)) {
      pos += size;
      [ch, size] = decodeRune(text, pos);
    }
  } else {
    while (pos < length) {
      const currentChar = text.charCodeAt(pos);
      if ((currentChar === 0x3d || currentChar === 0x3e) && currentChar !== ch && isConflictMarkerTrivia(text, pos)) {
        break;
      }
      pos++;
    }
  }
  return pos;
}

function isShebangTrivia(text: ByteString): boolean {
  if (text.length < 2) return false;
  return text.charCodeAt(0) === 0x23 && text.charCodeAt(1) === 0x21;
}

function scanShebangTrivia(text: ByteString, pos: number): number {
  pos += 2;
  while (pos < text.length) {
    const [ch, size] = decodeRune(text, pos);
    if (isLineBreak(ch)) break;
    pos += size;
  }
  return pos;
}

export function computeLineOfPosition(lineStarts: readonly number[], pos: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const middle = low + ((high - low) >> 1);
    const value = lineStarts[middle];
    if (value < pos) low = middle + 1;
    else if (value > pos) high = middle - 1;
    else return middle;
  }
  return low - 1;
}
