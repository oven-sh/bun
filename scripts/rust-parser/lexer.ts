// Rust lexer. Produces a flat token array plus the comments it skipped.
//
// Punctuation is emitted one character at a time with a `joint` flag (true
// when the next character is also punctuation with no whitespace between).
// The parser composes multi-character operators from joint runs. This is what
// lets `Vec<Vec<u8>>` close two generic lists with what would otherwise lex as
// a single `>>` token.

export type TokenKind = "ident" | "lifetime" | "literal" | "punct" | "open" | "close" | "eof";

export type LiteralKind = "int" | "float" | "str" | "byteStr" | "cStr" | "char" | "byte";

export interface Token {
  kind: TokenKind;
  /** Source text of the token. For `r#ident` this includes the `r#` prefix. */
  text: string;
  start: number;
  end: number;
  /** punct only: the next token is punctuation and starts at `end`. */
  joint: boolean;
  /** literal only. */
  lit: LiteralKind | null;
  /** int and float literals only: the type suffix (`u8`, `f32`), or null. */
  suffix: string | null;
}

export interface Comment {
  kind: "Comment";
  style: "line" | "block";
  /** `///` and `/**` comments are outer doc comments, `//!` and `/*!` inner. */
  doc: "outer" | "inner" | null;
  /** Full source text, delimiters included. */
  text: string;
  start: number;
  end: number;
}

export class RustLexError extends Error {
  constructor(
    message: string,
    public readonly offset: number,
  ) {
    super(message);
    this.name = "RustLexError";
  }
}

const C_TAB = 9;
const C_LF = 10;
const C_VT = 11;
const C_FF = 12;
const C_CR = 13;
const C_SPACE = 32;
const C_BANG = 33;
const C_DQUOTE = 34;
const C_HASH = 35;
const C_SQUOTE = 39;
const C_LPAREN = 40;
const C_RPAREN = 41;
const C_STAR = 42;
const C_PLUS = 43;
const C_MINUS = 45;
const C_DOT = 46;
const C_SLASH = 47;
const C_0 = 48;
const C_9 = 57;
const C_LT = 60;
const C_EQ = 61;
const C_GT = 62;
const C_UPPER_A = 65;
const C_UPPER_E = 69;
const C_UPPER_F = 70;
const C_UPPER_Z = 90;
const C_LBRACKET = 91;
const C_BACKSLASH = 92;
const C_RBRACKET = 93;
const C_UNDERSCORE = 95;
const C_LOWER_A = 97;
const C_LOWER_B = 98;
const C_LOWER_C = 99;
const C_LOWER_E = 101;
const C_LOWER_F = 102;
const C_LOWER_O = 111;
const C_LOWER_R = 114;
const C_LOWER_X = 120;
const C_LOWER_Z = 122;
const C_LBRACE = 123;
const C_RBRACE = 125;

const PUNCT_CHARS = "+-*/%^!&|=<>@.,;:#$?~";
const PUNCT_TABLE = new Uint8Array(128);
for (let i = 0; i < PUNCT_CHARS.length; i++) PUNCT_TABLE[PUNCT_CHARS.charCodeAt(i)] = 1;

const XID_START = /^\p{XID_Start}$/u;
const XID_CONTINUE = /^\p{XID_Continue}$/u;

function isIdentStart(src: string, i: number): boolean {
  const c = src.charCodeAt(i);
  if (c < 128) {
    return (c >= C_LOWER_A && c <= C_LOWER_Z) || (c >= C_UPPER_A && c <= C_UPPER_Z) || c === C_UNDERSCORE;
  }
  return XID_START.test(String.fromCodePoint(src.codePointAt(i)!));
}

function isIdentContinue(src: string, i: number): boolean {
  const c = src.charCodeAt(i);
  if (c < 128) {
    return (
      (c >= C_LOWER_A && c <= C_LOWER_Z) ||
      (c >= C_UPPER_A && c <= C_UPPER_Z) ||
      (c >= C_0 && c <= C_9) ||
      c === C_UNDERSCORE
    );
  }
  return XID_CONTINUE.test(String.fromCodePoint(src.codePointAt(i)!));
}

function codePointLength(src: string, i: number): number {
  const c = src.charCodeAt(i);
  return c >= 0xd800 && c <= 0xdbff && i + 1 < src.length ? 2 : 1;
}

function isDigit(c: number): boolean {
  return c >= C_0 && c <= C_9;
}

function isHexDigit(c: number): boolean {
  return (c >= C_0 && c <= C_9) || (c >= C_LOWER_A && c <= C_LOWER_F) || (c >= C_UPPER_A && c <= C_UPPER_F);
}

function scanIdentEnd(src: string, i: number): number {
  const n = src.length;
  while (i < n && isIdentContinue(src, i)) i += codePointLength(src, i);
  return i;
}

export interface LexResult {
  tokens: Token[];
  comments: Comment[];
}

function makeToken(
  kind: TokenKind,
  text: string,
  start: number,
  end: number,
  joint: boolean,
  lit: LiteralKind | null,
  suffix: string | null = null,
): Token {
  return { kind, text, start, end, joint, lit, suffix };
}

export function lex(src: string): LexResult {
  const tokens: Token[] = [];
  const comments: Comment[] = [];
  const n = src.length;
  let i = 0;

  // Shebang (`#!/usr/bin/env ...`) but not an inner attribute `#![...]`.
  if (src.startsWith("#!") && !/^#!\s*\[/.test(src)) {
    const nl = src.indexOf("\n");
    i = nl === -1 ? n : nl;
  }

  const fail = (msg: string, at: number): never => {
    throw new RustLexError(msg, at);
  };

  // Scans a quoted body starting at `i` (just after the opening quote), with
  // escape handling. Returns the index after the closing quote.
  const scanQuoted = (from: number, quote: number): number => {
    let j = from;
    while (j < n) {
      const c = src.charCodeAt(j);
      if (c === C_BACKSLASH) {
        j += 2;
        continue;
      }
      if (c === quote) return j + 1;
      j++;
    }
    return fail("unterminated string literal", from - 1);
  };

  // Raw string starting at `i` pointing at the first `#` or the `"`.
  const scanRaw = (from: number): number => {
    let hashes = 0;
    let j = from;
    while (j < n && src.charCodeAt(j) === C_HASH) {
      hashes++;
      j++;
    }
    if (src.charCodeAt(j) !== C_DQUOTE) return fail("malformed raw string literal", from);
    j++;
    const closer = '"' + "#".repeat(hashes);
    const at = src.indexOf(closer, j);
    if (at === -1) return fail("unterminated raw string literal", from);
    return at + closer.length;
  };

  const scanNumber = (from: number): number => {
    let j = from;
    let isFloat = false;
    const c0 = src.charCodeAt(j);
    const c1 = src.charCodeAt(j + 1);
    if (c0 === C_0 && (c1 === C_LOWER_X || c1 === C_LOWER_O || c1 === C_LOWER_B)) {
      j += 2;
      if (c1 === C_LOWER_X) {
        while (j < n && (isHexDigit(src.charCodeAt(j)) || src.charCodeAt(j) === C_UNDERSCORE)) j++;
      } else {
        while (j < n && (isDigit(src.charCodeAt(j)) || src.charCodeAt(j) === C_UNDERSCORE)) j++;
      }
    } else {
      while (j < n && (isDigit(src.charCodeAt(j)) || src.charCodeAt(j) === C_UNDERSCORE)) j++;
      // Fraction: `1.5`, `1.` (but not `1..2`, `1.foo`, `1._`).
      if (src.charCodeAt(j) === C_DOT) {
        const d = src.charCodeAt(j + 1);
        const nextIsIdent = j + 1 < n && isIdentStart(src, j + 1);
        if (d !== C_DOT && !nextIsIdent) {
          isFloat = true;
          j++;
          while (j < n && (isDigit(src.charCodeAt(j)) || src.charCodeAt(j) === C_UNDERSCORE)) j++;
        }
      }
      // Exponent: `1e10`, `1.5E-3`.
      const e = src.charCodeAt(j);
      if (e === C_LOWER_E || e === C_UPPER_E) {
        let k = j + 1;
        const s = src.charCodeAt(k);
        if (s === C_PLUS || s === C_MINUS) k++;
        while (k < n && src.charCodeAt(k) === C_UNDERSCORE) k++;
        if (isDigit(src.charCodeAt(k))) {
          isFloat = true;
          j = k;
          while (j < n && (isDigit(src.charCodeAt(j)) || src.charCodeAt(j) === C_UNDERSCORE)) j++;
        }
      }
    }
    // Suffix (`u8`, `f32`, `usize`, ...): any identifier glued to the digits.
    // In a hex literal the digits `f32` are digits, not a suffix, so `0x1f32`
    // has none; the suffix is whatever the digit scan above did not consume.
    let suffix: string | null = null;
    if (j < n && isIdentStart(src, j)) {
      const sufStart = j;
      j = scanIdentEnd(src, j);
      suffix = src.slice(sufStart, j);
      if (suffix === "f32" || suffix === "f64") isFloat = true;
    }
    tokens.push(makeToken("literal", src.slice(from, j), from, j, false, isFloat ? "float" : "int", suffix));
    return j;
  };

  while (i < n) {
    const c = src.charCodeAt(i);

    // Whitespace.
    if (c === C_SPACE || c === C_LF || c === C_CR || c === C_TAB || c === C_VT || c === C_FF) {
      i++;
      continue;
    }

    // Comments.
    if (c === C_SLASH) {
      const c1 = src.charCodeAt(i + 1);
      if (c1 === C_SLASH) {
        let j = src.indexOf("\n", i);
        if (j === -1) j = n;
        const c2 = src.charCodeAt(i + 2);
        const c3 = src.charCodeAt(i + 3);
        let doc: Comment["doc"] = null;
        if (c2 === C_SLASH && c3 !== C_SLASH) doc = "outer";
        else if (c2 === C_BANG) doc = "inner";
        // Exclude a trailing `\r` from the comment text.
        let end = j;
        if (end > i && src.charCodeAt(end - 1) === C_CR) end--;
        comments.push({ kind: "Comment", style: "line", doc, text: src.slice(i, end), start: i, end });
        i = j;
        continue;
      }
      if (c1 === C_STAR) {
        // Block comments nest.
        let depth = 1;
        let j = i + 2;
        while (j < n && depth > 0) {
          const d = src.charCodeAt(j);
          if (d === C_SLASH && src.charCodeAt(j + 1) === C_STAR) {
            depth++;
            j += 2;
          } else if (d === C_STAR && src.charCodeAt(j + 1) === C_SLASH) {
            depth--;
            j += 2;
          } else {
            j++;
          }
        }
        if (depth > 0) fail("unterminated block comment", i);
        const c2 = src.charCodeAt(i + 2);
        const c3 = src.charCodeAt(i + 3);
        let doc: Comment["doc"] = null;
        // `/**/` and `/***/` are plain comments.
        if (c2 === C_STAR && c3 !== C_STAR && c3 !== C_SLASH) doc = "outer";
        else if (c2 === C_BANG) doc = "inner";
        comments.push({ kind: "Comment", style: "block", doc, text: src.slice(i, j), start: i, end: j });
        i = j;
        continue;
      }
    }

    // Identifiers, keywords, raw identifiers, and prefixed literals.
    if (isIdentStart(src, i)) {
      // Prefixed string/char literals: b"", b'', br"", r"", r#"", c"", cr"".
      if (c === C_LOWER_B || c === C_LOWER_R || c === C_LOWER_C) {
        const c1 = src.charCodeAt(i + 1);
        if (c === C_LOWER_B) {
          if (c1 === C_DQUOTE) {
            const end = scanQuoted(i + 2, C_DQUOTE);
            tokens.push(makeToken("literal", src.slice(i, end), i, end, false, "byteStr"));
            i = end;
            continue;
          }
          if (c1 === C_SQUOTE) {
            const end = scanQuoted(i + 2, C_SQUOTE);
            tokens.push(makeToken("literal", src.slice(i, end), i, end, false, "byte"));
            i = end;
            continue;
          }
          if (c1 === C_LOWER_R) {
            const c2 = src.charCodeAt(i + 2);
            if (c2 === C_DQUOTE || c2 === C_HASH) {
              const end = scanRaw(i + 2);
              tokens.push(makeToken("literal", src.slice(i, end), i, end, false, "byteStr"));
              i = end;
              continue;
            }
          }
        } else if (c === C_LOWER_C) {
          if (c1 === C_DQUOTE) {
            const end = scanQuoted(i + 2, C_DQUOTE);
            tokens.push(makeToken("literal", src.slice(i, end), i, end, false, "cStr"));
            i = end;
            continue;
          }
          if (c1 === C_LOWER_R) {
            const c2 = src.charCodeAt(i + 2);
            if (c2 === C_DQUOTE || c2 === C_HASH) {
              const end = scanRaw(i + 2);
              tokens.push(makeToken("literal", src.slice(i, end), i, end, false, "cStr"));
              i = end;
              continue;
            }
          }
        } else {
          // c === 'r'
          if (c1 === C_DQUOTE) {
            const end = scanRaw(i + 1);
            tokens.push(makeToken("literal", src.slice(i, end), i, end, false, "str"));
            i = end;
            continue;
          }
          if (c1 === C_HASH) {
            const c2 = src.charCodeAt(i + 2);
            if (c2 === C_DQUOTE || c2 === C_HASH) {
              const end = scanRaw(i + 1);
              tokens.push(makeToken("literal", src.slice(i, end), i, end, false, "str"));
              i = end;
              continue;
            }
            if (i + 2 < n && isIdentStart(src, i + 2)) {
              // Raw identifier `r#type`.
              const end = scanIdentEnd(src, i + 2);
              tokens.push(makeToken("ident", src.slice(i, end), i, end, false, null));
              i = end;
              continue;
            }
          }
        }
      }
      const end = scanIdentEnd(src, i);
      tokens.push(makeToken("ident", src.slice(i, end), i, end, false, null));
      i = end;
      continue;
    }

    // Numbers.
    if (isDigit(c)) {
      i = scanNumber(i);
      continue;
    }

    // Strings.
    if (c === C_DQUOTE) {
      const end = scanQuoted(i + 1, C_DQUOTE);
      tokens.push(makeToken("literal", src.slice(i, end), i, end, false, "str"));
      i = end;
      continue;
    }

    // Char literal or lifetime.
    if (c === C_SQUOTE) {
      const c1 = src.charCodeAt(i + 1);
      if (c1 === C_BACKSLASH) {
        const end = scanQuoted(i + 1, C_SQUOTE);
        tokens.push(makeToken("literal", src.slice(i, end), i, end, false, "char"));
        i = end;
        continue;
      }
      const cpLen = codePointLength(src, i + 1);
      if (i + 1 < n && src.charCodeAt(i + 1 + cpLen) === C_SQUOTE) {
        const end = i + 2 + cpLen;
        tokens.push(makeToken("literal", src.slice(i, end), i, end, false, "char"));
        i = end;
        continue;
      }
      if (i + 1 < n && isIdentStart(src, i + 1)) {
        const end = scanIdentEnd(src, i + 1);
        tokens.push(makeToken("lifetime", src.slice(i, end), i, end, false, null));
        i = end;
        continue;
      }
      fail("unexpected `'`", i);
    }

    // Delimiters.
    if (c === C_LPAREN || c === C_LBRACKET || c === C_LBRACE) {
      tokens.push(makeToken("open", src[i], i, i + 1, false, null));
      i++;
      continue;
    }
    if (c === C_RPAREN || c === C_RBRACKET || c === C_RBRACE) {
      tokens.push(makeToken("close", src[i], i, i + 1, false, null));
      i++;
      continue;
    }

    // Punctuation. `joint` means the next token is punctuation too; a `/`
    // that opens a comment is not a token, so `a &/**/& b` is `&`, `&`, not `&&`.
    if (c < 128 && PUNCT_TABLE[c] === 1) {
      const c1 = i + 1 < n ? src.charCodeAt(i + 1) : 0;
      const c2 = i + 2 < n ? src.charCodeAt(i + 2) : 0;
      const opensComment = c1 === C_SLASH && (c2 === C_SLASH || c2 === C_STAR);
      const joint = c1 < 128 && PUNCT_TABLE[c1] === 1 && !opensComment;
      tokens.push(makeToken("punct", src[i], i, i + 1, joint, null));
      i++;
      continue;
    }

    // Byte order mark and the non-ASCII members of Pattern_White_Space.
    if (c === 0xfeff || c === 0x85 || c === 0x200e || c === 0x200f || c === 0x2028 || c === 0x2029) {
      i++;
      continue;
    }
    fail(`unexpected character ${JSON.stringify(src[i])}`, i);
  }

  tokens.push(makeToken("eof", "", n, n, false, null));
  return { tokens, comments };
}

// Token trees, used for macro bodies, macro invocations, and attribute
// arguments, where Rust itself only requires balanced delimiters.

export type TokenTree = TokenLeaf | TokenGroup;

export interface TokenLeaf {
  kind: "ident" | "punct" | "literal" | "lifetime";
  text: string;
  start: number;
  end: number;
  joint: boolean;
  lit: LiteralKind | null;
  suffix: string | null;
}

export interface TokenGroup {
  kind: "group";
  delim: "(" | "[" | "{";
  trees: TokenTree[];
  start: number;
  end: number;
}

const CLOSE_OF: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

/**
 * Builds token trees from `tokens[from..to)`. The range must be balanced.
 */
export function buildTokenTrees(tokens: Token[], from: number, to: number): TokenTree[] {
  const out: TokenTree[] = [];
  let i = from;
  while (i < to) {
    const t = tokens[i];
    if (t.kind === "open") {
      const close = CLOSE_OF[t.text];
      let depth = 1;
      let j = i + 1;
      while (j < to && depth > 0) {
        const k = tokens[j].kind;
        if (k === "open") depth++;
        else if (k === "close") depth--;
        if (depth > 0) j++;
      }
      if (depth !== 0 || tokens[j].text !== close) {
        throw new RustLexError(`unbalanced \`${t.text}\``, t.start);
      }
      out.push({
        kind: "group",
        delim: t.text as "(" | "[" | "{",
        trees: buildTokenTrees(tokens, i + 1, j),
        start: t.start,
        end: tokens[j].end,
      });
      i = j + 1;
      continue;
    }
    if (t.kind === "close") throw new RustLexError(`unexpected \`${t.text}\``, t.start);
    out.push({
      kind: t.kind as TokenLeaf["kind"],
      text: t.text,
      start: t.start,
      end: t.end,
      joint: t.joint,
      lit: t.lit,
      suffix: t.suffix,
    });
    i++;
  }
  return out;
}

/** Flattens token trees back into a token array (with an EOF sentinel). */
export function flattenTokenTrees(trees: TokenTree[], end: number): Token[] {
  const out: Token[] = [];
  const visit = (list: TokenTree[]) => {
    for (const t of list) {
      if (t.kind === "group") {
        out.push(makeToken("open", t.delim, t.start, t.start + 1, false, null));
        visit(t.trees);
        out.push(makeToken("close", CLOSE_OF[t.delim], t.end - 1, t.end, false, null));
      } else {
        out.push(makeToken(t.kind, t.text, t.start, t.end, t.joint, t.lit, t.suffix));
      }
    }
  };
  visit(trees);
  out.push(makeToken("eof", "", end, end, false, null));
  return out;
}

/** Splits token trees on top-level commas. A trailing comma does not produce an empty chunk. */
export function splitTokenTrees(trees: TokenTree[], separator = ","): TokenTree[][] {
  const chunks: TokenTree[][] = [];
  let cur: TokenTree[] = [];
  for (const t of trees) {
    if (t.kind === "punct" && t.text === separator) {
      chunks.push(cur);
      cur = [];
    } else {
      cur.push(t);
    }
  }
  if (cur.length > 0) chunks.push(cur);
  return chunks;
}

/** Source text covered by a list of token trees, as written. */
export function tokenTreesText(src: string, trees: TokenTree[]): string {
  if (trees.length === 0) return "";
  return src.slice(trees[0].start, trees[trees.length - 1].end);
}
