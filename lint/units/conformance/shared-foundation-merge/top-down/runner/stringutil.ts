// Port of internal/stringutil/util.go and compare.go of microsoft/typescript-go at 89d5d5b: the rune tests and the comparers.
import { compareStrings, equalFold, unicodeToLower } from "./gostrings";

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

export function equateStringCaseInsensitive(a: string, b: string): boolean {
  return equalFold(a, b);
}

export function equateStringCaseSensitive(a: string, b: string): boolean {
  return a === b;
}

export function getStringEqualityComparer(ignoreCase: boolean): (a: string, b: string) => boolean {
  return ignoreCase ? equateStringCaseInsensitive : equateStringCaseSensitive;
}

export type Comparison = -1 | 0 | 1;

export function compareStringsCaseInsensitive(a: string, b: string): Comparison {
  if (a === b) return 0;
  let i = 0;
  let j = 0;
  for (;;) {
    if (i >= a.length) return j >= b.length ? 0 : -1;
    if (j >= b.length) return 1;
    const ca = a.codePointAt(i)!;
    const cb = b.codePointAt(j)!;
    const lca = unicodeToLower(ca);
    const lcb = unicodeToLower(cb);
    if (lca !== lcb) return lca < lcb ? -1 : 1;
    i += ca > 0xffff ? 2 : 1;
    j += cb > 0xffff ? 2 : 1;
  }
}

export function compareStringsCaseSensitive(a: string, b: string): Comparison {
  return compareStrings(a, b);
}

export function getStringComparer(ignoreCase: boolean): (a: string, b: string) => Comparison {
  return ignoreCase ? compareStringsCaseInsensitive : compareStringsCaseSensitive;
}
