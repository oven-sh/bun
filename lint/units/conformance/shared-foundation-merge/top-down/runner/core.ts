// Port of internal/core/core.go of microsoft/typescript-go at 89d5d5b: line starts and UTF-16 lengths of a Go string.
import { type ByteString, decodeRune } from "./bytestring";
import { isLineBreak } from "./stringutil";

// ComputeECMALineStarts: LF, CR, CR LF, U+2028 and U+2029 end a line.
export function computeECMALineStarts(text: ByteString): number[] {
  const result: number[] = [];
  const textLen = text.length;
  let pos = 0;
  let lineStart = 0;
  while (pos < textLen) {
    const b = text.charCodeAt(pos);
    if (b < 0x80) {
      pos++;
      if (b === 0x0d) {
        if (pos < textLen && text.charCodeAt(pos) === 0x0a) pos++;
        result.push(lineStart);
        lineStart = pos;
      } else if (b === 0x0a) {
        result.push(lineStart);
        lineStart = pos;
      }
    } else {
      const [ch, size] = decodeRune(text, pos);
      pos += size;
      if (isLineBreak(ch)) {
        result.push(lineStart);
        lineStart = pos;
      }
    }
  }
  result.push(lineStart);
  return result;
}

// UTF16Len: the number of UTF-16 code units of the UTF-8 text.
export function utf16Len(s: ByteString): number {
  let n = 0;
  for (let i = 0; i < s.length; ) {
    const c = s.charCodeAt(i);
    if (c < 0x80) {
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
