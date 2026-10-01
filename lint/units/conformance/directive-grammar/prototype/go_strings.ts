// Go's strings.TrimSpace, strings.TrimSuffix and strings.ToLower, which differ from the JavaScript methods.

// Go's unicode.IsSpace: it has U+0085 and lacks U+FEFF, unlike String.prototype.trim.
export function isSpace(ch: number): boolean {
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

export function trimSpace(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && isSpace(s.charCodeAt(start))) start++;
  while (end > start && isSpace(s.charCodeAt(end - 1))) end--;
  return s.slice(start, end);
}

export function trimSuffix(s: string, suffix: string): string {
  return s.endsWith(suffix) ? s.slice(0, s.length - suffix.length) : s;
}

// One code point at a time, as Go does: U+0130 lowers to "i" and no final sigma rule applies.
export function toLower(s: string): string {
  let out = "";
  for (const ch of s) {
    out += ch === "\u0130" ? "i" : ch.toLowerCase();
  }
  return out;
}
