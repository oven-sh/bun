/**
 * A small TOML reader — enough of TOML 1.0 for Cargo manifests (tables, arrays of tables, dotted/quoted
 * keys, basic/literal/multi-line strings, integers, floats, booleans, arrays, inline tables; no
 * datetimes). Used by the Rust planner to read the one thing cargo's JSON interfaces don't export: the
 * `[lints]` / `[workspace.lints]` tables. It checks syntax and duplicate keys, not TOML's rules about
 * which tables may be reopened.
 *
 * Two layers with a token boundary between them: `Scanner` owns the source text and the cursor and
 * produces typed tokens; `Parser` sees only tokens and decides only on them. TOML lexes by position —
 * `1.2` is a float where a value is expected and two keys where a key is expected; `[[` opens an array of
 * tables where a key is expected and two arrays where a value is — so the parser names the position
 * when it asks for the next token. The scanner looks only at the character under its cursor.
 */

import { BuildError } from "../error.ts";
export type TomlValue = string | number | boolean | TomlValue[] | TomlTable;
export interface TomlTable {
  [key: string]: TomlValue;
}

export function parseToml(src: string, file = "<toml>"): TomlTable {
  return new Parser(new Scanner(src, file), file).document();
}

function fail(file: string, line: number, msg: string): never {
  throw new BuildError(`${file}:${line}: ${msg}`, { file });
}

// ───────────────────────────────────────────────────────────────────────────
// Tokens
// ───────────────────────────────────────────────────────────────────────────

type Punctuation = "." | "=" | "," | "[" | "[[" | "]" | "]]" | "{" | "}" | "newline" | "eof";

type Token =
  /** `bare`: an unquoted key. `string`: a quoted key or a string value, escapes resolved. */
  | { kind: "bare" | "string"; text: string; line: number }
  | { kind: "number"; value: number; line: number }
  | { kind: "boolean"; value: boolean; line: number }
  | { kind: Punctuation; line: number };

/** What the grammar expects next: decides how an unquoted word and a doubled bracket are lexed. */
type Position = "key" | "value";

// ───────────────────────────────────────────────────────────────────────────
// Characters
// ───────────────────────────────────────────────────────────────────────────

const EOF = -1;
const TAB = 0x09;
const LF = 0x0a;
const CR = 0x0d;
const SPACE = 0x20;
const DOUBLE_QUOTE = 0x22;
const HASH = 0x23;
const SINGLE_QUOTE = 0x27;
const PLUS = 0x2b;
const COMMA = 0x2c;
const MINUS = 0x2d;
const DOT = 0x2e;
const EQUALS = 0x3d;
const OPEN_BRACKET = 0x5b;
const BACKSLASH = 0x5c;
const CLOSE_BRACKET = 0x5d;
const UNDERSCORE = 0x5f;
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;
const DELETE = 0x7f;

const isDigit = (c: number): boolean => c >= 0x30 && c <= 0x39;
const isLetter = (c: number): boolean => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
/** `A-Za-z0-9_-` */
const isBareKeyChar = (c: number): boolean => isLetter(c) || isDigit(c) || c === UNDERSCORE || c === MINUS;
/** What a number or boolean is made of: `A-Za-z0-9_+-.` */
const isLiteralChar = (c: number): boolean => isBareKeyChar(c) || c === PLUS || c === DOT;
/** The value of a digit in bases up to 16, or -1. */
function digitValue(c: number): number {
  if (isDigit(c)) return c - 0x30;
  if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10;
  if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10;
  return -1;
}

// ───────────────────────────────────────────────────────────────────────────
// Scanner
// ───────────────────────────────────────────────────────────────────────────

class Scanner {
  readonly #src: string;
  readonly #file: string;
  #at = 0;
  #line = 1;

  constructor(src: string, file: string) {
    this.#src = src;
    this.#file = file;
  }

  /** The character under the cursor. */
  #cur(): number {
    return this.#at < this.#src.length ? this.#src.charCodeAt(this.#at) : EOF;
  }

  #fail(msg: string): never {
    return fail(this.#file, this.#line, msg);
  }

  /** Consume the newline under the cursor (`\n` or `\r\n`) and return its text. */
  #newline(): string {
    if (this.#cur() === LF) {
      this.#at++;
      this.#line++;
      return "\n";
    }
    this.#at++; // CR
    if (this.#cur() !== LF) this.#fail("carriage return without a line feed");
    this.#at++;
    this.#line++;
    return "\r\n";
  }

  next(position: Position): Token {
    while (this.#cur() === SPACE || this.#cur() === TAB) this.#at++;
    if (this.#cur() === HASH) {
      while (this.#cur() !== LF && this.#cur() !== CR && this.#cur() !== EOF) this.#at++;
    }
    const line = this.#line;
    const c = this.#cur();
    const punctuation = (kind: Punctuation): Token => {
      this.#at++;
      return { kind, line };
    };
    switch (c) {
      case EOF:
        return { kind: "eof", line };
      case LF:
      case CR:
        this.#newline();
        return { kind: "newline", line };
      case EQUALS:
        return punctuation("=");
      case COMMA:
        return punctuation(",");
      case OPEN_BRACE:
        return punctuation("{");
      case CLOSE_BRACE:
        return punctuation("}");
      case OPEN_BRACKET:
      case CLOSE_BRACKET: {
        // Where a key is expected a doubled bracket is one token (`[[bin]]`); in a value it is two arrays.
        this.#at++;
        const doubled = position === "key" && this.#cur() === c;
        if (doubled) this.#at++;
        if (c === OPEN_BRACKET) return { kind: doubled ? "[[" : "[", line };
        return { kind: doubled ? "]]" : "]", line };
      }
      case DOUBLE_QUOTE:
      case SINGLE_QUOTE:
        // Keys are single-line strings; only a value can be `"""multi-line"""`.
        return { kind: "string", text: this.#string(position === "value"), line };
    }
    if (position === "key") {
      if (c === DOT) return punctuation(".");
      if (isBareKeyChar(c)) return { kind: "bare", text: this.#run(isBareKeyChar), line };
      return this.#fail(`unexpected character ${JSON.stringify(String.fromCharCode(c))} where a key is expected`);
    }
    if (isLiteralChar(c)) return literal(this.#run(isLiteralChar), this.#file, line);
    return this.#fail(`unexpected character ${JSON.stringify(String.fromCharCode(c))} where a value is expected`);
  }

  /** The characters from the cursor on that satisfy `accept`. */
  #run(accept: (c: number) => boolean): string {
    let text = "";
    while (accept(this.#cur())) {
      text += String.fromCharCode(this.#cur());
      this.#at++;
    }
    return text;
  }

  /** A string whose opening quote is under the cursor: basic (`"`, with escapes) or literal (`'`). */
  #string(allowMultiline: boolean): string {
    const quote = this.#cur();
    const quoteText = String.fromCharCode(quote);
    this.#at++;
    let multiline = false;
    if (this.#cur() === quote) {
      this.#at++;
      // Two quotes: the empty string — unless a third makes it the opening of a multi-line string.
      if (this.#cur() !== quote || !allowMultiline) return "";
      this.#at++;
      multiline = true;
      // A newline right after the opening delimiter is not part of the string.
      if (this.#cur() === LF || this.#cur() === CR) this.#newline();
    }
    let text = "";
    for (;;) {
      const c = this.#cur();
      if (c === EOF) this.#fail("unterminated string");
      if (c === quote) {
        if (!multiline) {
          this.#at++;
          return text;
        }
        // A run of quotes: three close the string, and one or two more before those are content.
        let run = 0;
        while (this.#cur() === quote && run < 5) {
          this.#at++;
          run++;
        }
        if (run >= 3) return text + quoteText.repeat(run - 3);
        text += quoteText.repeat(run);
      } else if (c === LF || c === CR) {
        if (!multiline) this.#fail("newline in a single-line string");
        text += this.#newline();
      } else if (c === BACKSLASH && quote === DOUBLE_QUOTE) {
        this.#at++;
        text += this.#escape(multiline);
      } else if ((c < SPACE && c !== TAB) || c === DELETE) {
        this.#fail("control character in a string");
      } else {
        text += String.fromCharCode(c);
        this.#at++;
      }
    }
  }

  /** The text an escape sequence stands for; the cursor is on the character after the backslash. */
  #escape(multiline: boolean): string {
    const c = this.#cur();
    const simple = (text: string): string => {
      this.#at++;
      return text;
    };
    switch (c) {
      case 0x62: // b
        return simple("\b");
      case 0x74: // t
        return simple("\t");
      case 0x6e: // n
        return simple("\n");
      case 0x66: // f
        return simple("\f");
      case 0x72: // r
        return simple("\r");
      case DOUBLE_QUOTE:
        return simple('"');
      case BACKSLASH:
        return simple("\\");
      case 0x75: // u: four hex digits
      case 0x55: {
        // U: eight hex digits
        this.#at++;
        let scalar = 0;
        for (let n = c === 0x75 ? 4 : 8; n > 0; n--) {
          const digit = digitValue(this.#cur());
          if (digit < 0) this.#fail("expected a hexadecimal digit in a unicode escape");
          scalar = scalar * 16 + digit;
          this.#at++;
        }
        if (scalar > 0x10ffff || (scalar >= 0xd800 && scalar <= 0xdfff)) {
          this.#fail("unicode escape is not a scalar value");
        }
        return String.fromCodePoint(scalar);
      }
      case SPACE:
      case TAB:
      case LF:
      case CR: {
        // A backslash ending a line of a multi-line string: the newline and all blank space after it are dropped.
        if (!multiline) this.#fail("line-ending backslash in a single-line string");
        while (this.#cur() === SPACE || this.#cur() === TAB) this.#at++;
        if (this.#cur() !== LF && this.#cur() !== CR) this.#fail("only blank space may follow a line-ending backslash");
        for (;;) {
          if (this.#cur() === LF || this.#cur() === CR) this.#newline();
          else if (this.#cur() === SPACE || this.#cur() === TAB) this.#at++;
          else return "";
        }
      }
    }
    return this.#fail(c === EOF ? "unterminated string" : `invalid escape \\${String.fromCharCode(c)}`);
  }
}

/** The boolean or number an unquoted value word spells. */
function literal(word: string, file: string, line: number): Token {
  if (word === "true") return { kind: "boolean", value: true, line };
  if (word === "false") return { kind: "boolean", value: false, line };
  const invalid = (): never =>
    fail(file, line, `${JSON.stringify(word)} is not a number or boolean (datetimes are not supported)`);

  const signed = word.charCodeAt(0) === PLUS || word.charCodeAt(0) === MINUS;
  const negative = word.charCodeAt(0) === MINUS;
  const body = signed ? word.slice(1) : word;
  if (body === "inf") return { kind: "number", value: negative ? -Infinity : Infinity, line };
  if (body === "nan") return { kind: "number", value: NaN, line };

  let at = 0;
  /** Digits of `base` from `at` on, `_` allowed only between two digits; returns them without the underscores. */
  const digits = (base: number): string => {
    let out = "";
    let afterUnderscore = false;
    for (; at < body.length; at++) {
      const c = body.charCodeAt(at);
      const value = digitValue(c);
      if (value >= 0 && value < base) {
        out += body[at];
        afterUnderscore = false;
      } else if (c === UNDERSCORE && out !== "" && !afterUnderscore) {
        afterUnderscore = true;
      } else break;
    }
    if (out === "" || afterUnderscore) invalid();
    return out;
  };

  const base = body.startsWith("0x") ? 16 : body.startsWith("0o") ? 8 : body.startsWith("0b") ? 2 : 10;
  if (base !== 10) {
    if (signed) invalid(); // TOML: prefixed integers take no sign
    at = 2;
    const value = parseInt(digits(base), base);
    if (at !== body.length) invalid();
    return { kind: "number", value, line };
  }

  let text = digits(10);
  if (text.length > 1 && text[0] === "0") invalid(); // no leading zeros
  if (body[at] === ".") {
    at++;
    text += "." + digits(10);
  }
  if (body[at] === "e" || body[at] === "E") {
    at++;
    text += "e";
    if (body[at] === "+" || body[at] === "-") text += body[at++];
    text += digits(10);
  }
  if (at !== body.length) invalid();
  return { kind: "number", value: negative ? -Number(text) : Number(text), line };
}

// ───────────────────────────────────────────────────────────────────────────
// Parser
// ───────────────────────────────────────────────────────────────────────────

/** Tables are null-prototype objects: manifest keys like `constructor` must not meet Object.prototype. */
const newTable = (): TomlTable => Object.create(null) as TomlTable;
const isTable = (v: TomlValue | undefined): v is TomlTable => typeof v === "object" && !Array.isArray(v);

/**
 * Every method takes the token it starts at and returns the token after what it consumed; no token is
 * looked at before its position in the grammar is known, so none is ever scanned twice.
 */
class Parser {
  readonly #scanner: Scanner;
  readonly #file: string;

  constructor(scanner: Scanner, file: string) {
    this.#scanner = scanner;
    this.#file = file;
  }

  #fail(at: Token, msg: string): never {
    return fail(this.#file, at.line, msg);
  }

  document(): TomlTable {
    const root = newTable();
    let table = root;
    let tok = this.#scanner.next("key");
    for (;;) {
      if (tok.kind === "newline") {
        tok = this.#scanner.next("key");
        continue;
      }
      if (tok.kind === "eof") return root;
      if (tok.kind === "[" || tok.kind === "[[") {
        const close = tok.kind === "[" ? "]" : "]]";
        const header = this.#keyPath(this.#scanner.next("key"));
        if (header.next.kind !== close) this.#fail(header.next, `expected ${close} after the table name`);
        table = this.#openTable(root, header.path, close === "]]", tok);
        tok = this.#scanner.next("key");
      } else {
        const key = this.#keyPath(tok);
        if (key.next.kind !== "=") this.#fail(key.next, "expected = after the key");
        const value = this.#value(this.#scanner.next("value"));
        this.#assign(table, key.path, value.value, tok);
        tok = value.next;
      }
      if (tok.kind !== "newline" && tok.kind !== "eof") this.#fail(tok, "expected the end of the line");
    }
  }

  /** `a`, `a.b`, `"a b".c` */
  #keyPath(tok: Token): { path: string[]; next: Token } {
    const path: string[] = [];
    for (;;) {
      if (tok.kind !== "bare" && tok.kind !== "string") this.#fail(tok, "expected a key");
      path.push(tok.text);
      const next = this.#scanner.next("key");
      if (next.kind !== ".") return { path, next };
      tok = this.#scanner.next("key");
    }
  }

  #value(tok: Token): { value: TomlValue; next: Token } {
    switch (tok.kind) {
      case "string":
        return { value: tok.text, next: this.#scanner.next("value") };
      case "number":
      case "boolean":
        return { value: tok.value, next: this.#scanner.next("value") };
      case "[": {
        // Newlines (and the comments before them) are free inside an array; a trailing comma is allowed.
        const items: TomlValue[] = [];
        let at = this.#scanner.next("value");
        for (;;) {
          while (at.kind === "newline") at = this.#scanner.next("value");
          if (at.kind === "]") return { value: items, next: this.#scanner.next("value") };
          const item = this.#value(at);
          items.push(item.value);
          at = item.next;
          while (at.kind === "newline") at = this.#scanner.next("value");
          if (at.kind === ",") at = this.#scanner.next("value");
          else if (at.kind !== "]") this.#fail(at, "expected , or ] in the array");
        }
      }
      case "{": {
        // One line, no trailing comma.
        const table = newTable();
        let at = this.#scanner.next("key");
        if (at.kind === "}") return { value: table, next: this.#scanner.next("value") };
        for (;;) {
          const key = this.#keyPath(at);
          if (key.next.kind !== "=") this.#fail(key.next, "expected = after the key");
          const value = this.#value(this.#scanner.next("value"));
          this.#assign(table, key.path, value.value, at);
          if (value.next.kind === "}") return { value: table, next: this.#scanner.next("value") };
          if (value.next.kind !== ",") this.#fail(value.next, "expected , or } in the inline table");
          at = this.#scanner.next("key");
        }
      }
    }
    return this.#fail(tok, "expected a value");
  }

  /** Set `path` under `table`, creating the tables a dotted key passes through. */
  #assign(table: TomlTable, path: string[], value: TomlValue, at: Token): void {
    let cur = table;
    for (const part of path.slice(0, -1)) {
      const next = Object.hasOwn(cur, part) ? cur[part] : undefined;
      if (next === undefined) cur = cur[part] = newTable();
      else if (isTable(next)) cur = next;
      else this.#fail(at, `key ${path.join(".")} conflicts with a value that is not a table`);
    }
    const leaf = path[path.length - 1]!;
    if (Object.hasOwn(cur, leaf)) this.#fail(at, `duplicate key ${path.join(".")}`);
    cur[leaf] = value;
  }

  /** The table a `[path]` header names, or the new element a `[[path]]` header appends. */
  #openTable(root: TomlTable, path: string[], arrayOfTables: boolean, at: Token): TomlTable {
    let cur = root;
    path.forEach((part, index) => {
      let next = Object.hasOwn(cur, part) ? cur[part] : undefined;
      if (arrayOfTables && index === path.length - 1) {
        if (next === undefined) next = cur[part] = [];
        if (!Array.isArray(next))
          return this.#fail(at, `[[${path.join(".")}]] conflicts with a value that is not an array`);
        const element = newTable();
        next.push(element);
        cur = element;
        return;
      }
      if (next === undefined) next = cur[part] = newTable();
      // A path through an array of tables continues in its last element.
      if (Array.isArray(next)) next = next[next.length - 1];
      if (!isTable(next)) return this.#fail(at, `[${path.join(".")}] passes through a value that is not a table`);
      cur = next;
    });
    return cur;
  }
}
