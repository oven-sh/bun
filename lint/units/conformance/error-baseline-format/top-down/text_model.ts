// The unit of positions. The Go harness counts UTF-8 bytes and runes, the TypeScript harness UTF-16 code units.
// Text of the utf8 model is a string whose char codes are the bytes; text of the utf16 model is a plain string.
import { decodeRune, isSpace, replaceNonWhitespace, runeCount, trimRightSpace, utf16Len } from "./go_compat";

export interface TextModel {
  readonly name: "utf8" | "utf16";
  fromBytes(bytes: Uint8Array): string;
  toBytes(text: string): Buffer;
  // From and to a plain JavaScript string.
  fromString(text: string): string;
  toString(text: string): string;
  // ECMAScript line starts: LF, CR, CR LF, U+2028, U+2029.
  lineStarts(text: string): number[];
  // The harness split of a file into lines, before the trailing CR is cut.
  splitLines(content: string): string[];
  // UTF-16 code units of text[from:to]: the column of the first section.
  utf16Length(text: string, from: number, to: number): number;
  // Position that is `units` UTF-16 code units after `from`; undefined when that is no position of the model.
  advanceUTF16(text: string, from: number, units: number, limit: number): number | undefined;
  // Tildes for a slice, and the position after `count` tildes.
  squiggleCount(slice: string): number;
  advanceSquiggle(text: string, from: number, count: number): number | undefined;
  // Spaces before the tildes: every character that is not white space becomes one space.
  blankNonWhitespace(slice: string): string;
  // Length of a squiggle prefix in the unit of advanceSquiggle.
  prefixCount(prefix: string): number;
  // Matches a squiggle line after its four spaces of indent.
  readonly squigglePattern: RegExp;
  // Trim of a code snippet line.
  trimEnd(line: string): string;
  compare(a: string, b: string): number;
}

function lineStartsUtf8(text: string): number[] {
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
      if (ch === 0x2028 || ch === 0x2029) {
        result.push(lineStart);
        lineStart = pos;
      }
    }
  }
  result.push(lineStart);
  return result;
}

// ts.computeLineStarts of src/compiler/scanner.ts
function lineStartsUtf16(text: string): number[] {
  const result: number[] = [];
  let pos = 0;
  let lineStart = 0;
  while (pos < text.length) {
    const ch = text.charCodeAt(pos);
    pos++;
    switch (ch) {
      case 0x0d:
        if (text.charCodeAt(pos) === 0x0a) pos++;
      // falls through
      case 0x0a:
        result.push(lineStart);
        lineStart = pos;
        break;
      default:
        if (ch > 0x7f && (ch === 0x2028 || ch === 0x2029)) {
          result.push(lineStart);
          lineStart = pos;
        }
        break;
    }
  }
  result.push(lineStart);
  return result;
}

export const utf8Model: TextModel = {
  name: "utf8",
  fromBytes: bytes => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1"),
  toBytes: text => Buffer.from(text, "latin1"),
  fromString: text => Buffer.from(text, "utf8").toString("latin1"),
  toString: text => Buffer.from(text, "latin1").toString("utf8"),
  lineStarts: lineStartsUtf8,
  splitLines: content => content.split(/\r?\n/),
  utf16Length: (text, from, to) => utf16Len(text.slice(from, to)),
  advanceUTF16(text, from, units, limit) {
    let pos = from;
    let n = 0;
    while (n < units) {
      if (pos >= limit) return undefined;
      const c = text.charCodeAt(pos);
      if (c < 0x80) {
        pos++;
        n++;
      } else {
        const [r, size] = decodeRune(text, pos);
        pos += size;
        n += r >= 0x10000 ? 2 : 1;
      }
    }
    return n === units ? pos : undefined;
  },
  squiggleCount: runeCount,
  advanceSquiggle(text, from, count) {
    let pos = from;
    for (let n = 0; n < count; n++) {
      if (pos >= text.length) return undefined;
      const c = text.charCodeAt(pos);
      pos += c < 0x80 ? 1 : decodeRune(text, pos)[1];
    }
    return pos;
  },
  blankNonWhitespace: replaceNonWhitespace,
  prefixCount: prefix => prefix.length,
  squigglePattern: /^[\t\n\f\r ]*~*$/,
  trimEnd: trimRightSpace,
  compare: (a, b) => (a < b ? -1 : a > b ? 1 : 0),
};

export const utf16Model: TextModel = {
  name: "utf16",
  fromBytes: bytes => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("utf8"),
  toBytes: text => Buffer.from(text, "utf8"),
  fromString: text => text,
  toString: text => text,
  lineStarts: lineStartsUtf16,
  splitLines(content) {
    let lines = content.split("\n");
    if (lines.length === 1) lines = lines[0].split("\r");
    return lines;
  },
  utf16Length: (_text, from, to) => to - from,
  advanceUTF16: (_text, from, units, limit) => (from + units <= limit ? from + units : undefined),
  squiggleCount: slice => slice.length,
  advanceSquiggle: (text, from, count) => (from + count <= text.length ? from + count : undefined),
  blankNonWhitespace: slice => slice.replace(/\S/g, " "),
  prefixCount: prefix => prefix.length,
  squigglePattern: /^\s*~*$/,
  trimEnd: line => line.trimEnd(),
  // ts.compareStringsCaseSensitive compares code units.
  compare: (a, b) => (a < b ? -1 : a > b ? 1 : 0),
};

export { isSpace };
