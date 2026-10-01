// Port of the rune helpers in internal/stringutil/util.go that SkipTrivia uses.

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
    case 0x2000:
    case 0x2001:
    case 0x2002:
    case 0x2003:
    case 0x2004:
    case 0x2005:
    case 0x2006:
    case 0x2007:
    case 0x2008:
    case 0x2009:
    case 0x200a:
    case 0x200b:
    case 0x202f:
    case 0x205f:
    case 0x3000:
    case 0xfeff:
      return true;
  }
  return false;
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

// Go's unicode.IsSpace, the set that strings.TrimSpace removes.
export function isGoSpace(ch: number): boolean {
  switch (ch) {
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
  return ch >= 0x2000 && ch <= 0x200a;
}

// Port of strings.TrimSpace.
export function trimSpace(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && isGoSpace(s.charCodeAt(start))) start++;
  while (end > start && isGoSpace(s.charCodeAt(end - 1))) end--;
  return s.slice(start, end);
}

// Port of strings.TrimSuffix.
export function trimSuffix(s: string, suffix: string): string {
  return s.endsWith(suffix) ? s.slice(0, s.length - suffix.length) : s;
}

// Port of strings.ToLower: simple case mapping, one code point at a time.
export function toLower(s: string): string {
  let ascii = true;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) >= 0x80) {
      ascii = false;
      break;
    }
  }
  if (ascii) return s.toLowerCase();
  let out = "";
  for (const ch of s) {
    out += ch === "\u0130" ? "i" : ch.toLowerCase();
  }
  return out;
}
