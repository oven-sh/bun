// Port of the rune tests of internal/stringutil/util.go that SkipTrivia uses.

export function isWhiteSpaceLike(ch: number): boolean {
  return isWhiteSpaceSingleLine(ch) || isLineBreak(ch);
}

export function isWhiteSpaceSingleLine(ch: number): boolean {
  switch (ch) {
    case 0x20:
    case 0x09:
    case 0x0b:
    case 0x0c:
    case 0x0085:
    case 0x00a0:
    case 0x1680:
    case 0x202f:
    case 0x205f:
    case 0x3000:
    case 0xfeff:
      return true;
  }
  return ch >= 0x2000 && ch <= 0x200b;
}

export function isLineBreak(ch: number): boolean {
  switch (ch) {
    case 0x0a:
    case 0x0d:
    case 0x2028:
    case 0x2029:
      return true;
  }
  return false;
}
