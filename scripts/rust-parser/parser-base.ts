// Parser foundation: token cursor, operator composition, attributes, paths.
// The grammar is split across a chain of subclasses (types, patterns,
// expressions, items) so that each file stays readable. Methods a lower layer
// needs from a higher one are declared abstract here.

import type * as ast from "./ast.ts";
import { buildTokenTrees, type Token, type TokenTree } from "./lexer.ts";

export class RustParseError extends Error {
  constructor(
    message: string,
    public readonly offset: number,
    public path: string | undefined,
  ) {
    super(message);
    this.name = "RustParseError";
  }
}

/** Keywords that can never be used as a plain identifier (edition 2024). */
export const STRICT_KEYWORDS = new Set([
  "as",
  "break",
  "const",
  "continue",
  "crate",
  "else",
  "enum",
  "extern",
  "false",
  "fn",
  "for",
  "if",
  "impl",
  "in",
  "let",
  "loop",
  "match",
  "mod",
  "move",
  "mut",
  "pub",
  "ref",
  "return",
  "self",
  "Self",
  "static",
  "struct",
  "super",
  "trait",
  "true",
  "type",
  "unsafe",
  "use",
  "where",
  "while",
  "async",
  "await",
  "dyn",
  "gen",
  "try",
  // Reserved.
  "abstract",
  "become",
  "box",
  "do",
  "final",
  "macro",
  "override",
  "priv",
  "typeof",
  "unsized",
  "virtual",
  "yield",
]);

/** Keywords that are valid as the first segment of a path. */
const PATH_KEYWORDS = new Set(["self", "Self", "super", "crate"]);

const OPS3 = new Set(["..=", "...", "<<=", ">>="]);
const OPS2 = new Set([
  "..",
  "::",
  "->",
  "=>",
  "==",
  "!=",
  "<=",
  ">=",
  "&&",
  "||",
  "<<",
  ">>",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "^=",
  "&=",
  "|=",
]);

export abstract class ParserBase {
  pos = 0;
  /** Struct literals are not allowed in the expression being parsed (`if x == S {`). */
  noStruct = false;

  constructor(
    readonly tokens: Token[],
    readonly src: string,
    readonly path: string | undefined,
  ) {}

  // -- abstract hooks implemented by higher layers --------------------------

  abstract parseType(): ast.Type;
  abstract parseTypeNoBounds(): ast.Type;
  abstract parseAngleArgs(turbofish: boolean): ast.AngleArgs;
  abstract parseExpr(): ast.Expr;
  abstract parseBlock(): ast.Block;

  // -- token cursor ---------------------------------------------------------

  peek(k = 0): Token {
    const i = this.pos + k;
    return i < this.tokens.length ? this.tokens[i] : this.tokens[this.tokens.length - 1];
  }

  get tok(): Token {
    return this.tokens[this.pos];
  }

  next(): Token {
    const t = this.tokens[this.pos];
    if (t.kind !== "eof") this.pos++;
    return t;
  }

  /** End offset of the most recently consumed token. */
  prevEnd(): number {
    return this.pos > 0 ? this.tokens[this.pos - 1].end : 0;
  }

  error(message: string, tok: Token = this.tok): never {
    const found = tok.kind === "eof" ? "end of input" : `\`${tok.text}\``;
    throw new RustParseError(`${message}, found ${found}`, tok.start, this.path);
  }

  atEof(): boolean {
    return this.tok.kind === "eof";
  }

  // -- identifiers and keywords --------------------------------------------

  /** Current token is the identifier/keyword `text` exactly (raw identifiers do not count). */
  isKw(text: string, k = 0): boolean {
    const t = this.peek(k);
    return t.kind === "ident" && t.text === text;
  }

  eatKw(text: string): boolean {
    if (this.isKw(text)) {
      this.pos++;
      return true;
    }
    return false;
  }

  expectKw(text: string): Token {
    if (!this.isKw(text)) this.error(`expected \`${text}\``);
    return this.next();
  }

  /** Current token is a non-keyword identifier (raw identifiers included, `_` excluded). */
  isIdent(k = 0): boolean {
    const t = this.peek(k);
    return t.kind === "ident" && t.text !== "_" && !STRICT_KEYWORDS.has(t.text);
  }

  /** Identifier or one of `self`, `Self`, `super`, `crate`. */
  isPathStartIdent(k = 0): boolean {
    const t = this.peek(k);
    return t.kind === "ident" && t.text !== "_" && (!STRICT_KEYWORDS.has(t.text) || PATH_KEYWORDS.has(t.text));
  }

  expectIdent(): string {
    if (!this.isIdent()) this.error("expected identifier");
    return this.next().text;
  }

  isUnderscore(k = 0): boolean {
    const t = this.peek(k);
    return t.kind === "ident" && t.text === "_";
  }

  isLiteral(k = 0): boolean {
    return this.peek(k).kind === "literal";
  }

  isLifetime(k = 0): boolean {
    return this.peek(k).kind === "lifetime";
  }

  // -- punctuation ----------------------------------------------------------

  /** Longest operator spelled by the joint punctuation run at the cursor, or null. */
  peekOp(k = 0): string | null {
    const t = this.peek(k);
    if (t.kind !== "punct") return null;
    if (t.joint) {
      const t2 = this.peek(k + 1);
      if (t2.joint) {
        const s3 = t.text + t2.text + this.peek(k + 2).text;
        if (OPS3.has(s3)) return s3;
      }
      const s2 = t.text + t2.text;
      if (OPS2.has(s2)) return s2;
    }
    return t.text;
  }

  /** The operator at the cursor is exactly `op` (longest match). */
  isOp(op: string, k = 0): boolean {
    return this.peekOp(k) === op;
  }

  eatOp(op: string): boolean {
    if (this.peekOp() === op) {
      this.pos += op.length;
      return true;
    }
    return false;
  }

  expectOp(op: string): void {
    if (!this.eatOp(op)) this.error(`expected \`${op}\``);
  }

  /** Current token is the single punctuation character `ch`, whatever follows it. */
  isChar(ch: string, k = 0): boolean {
    const t = this.peek(k);
    return t.kind === "punct" && t.text === ch;
  }

  eatChar(ch: string): boolean {
    if (this.isChar(ch)) {
      this.pos++;
      return true;
    }
    return false;
  }

  expectChar(ch: string): void {
    if (!this.eatChar(ch)) this.error(`expected \`${ch}\``);
  }

  isOpen(delim: string, k = 0): boolean {
    const t = this.peek(k);
    return t.kind === "open" && t.text === delim;
  }

  isClose(delim: string, k = 0): boolean {
    const t = this.peek(k);
    return t.kind === "close" && t.text === delim;
  }

  eatOpen(delim: string): boolean {
    if (this.isOpen(delim)) {
      this.pos++;
      return true;
    }
    return false;
  }

  eatClose(delim: string): boolean {
    if (this.isClose(delim)) {
      this.pos++;
      return true;
    }
    return false;
  }

  expectOpen(delim: string): Token {
    if (!this.isOpen(delim)) this.error(`expected \`${delim}\``);
    return this.next();
  }

  expectClose(delim: string): Token {
    if (!this.isClose(delim)) this.error(`expected \`${delim}\``);
    return this.next();
  }

  /** Index of the close delimiter matching the open delimiter at `openIdx`. */
  matchingClose(openIdx: number): number {
    let depth = 0;
    for (let i = openIdx; i < this.tokens.length; i++) {
      const k = this.tokens[i].kind;
      if (k === "open") depth++;
      else if (k === "close") {
        depth--;
        if (depth === 0) return i;
      } else if (k === "eof") break;
    }
    return this.error("unclosed delimiter", this.tokens[openIdx]);
  }

  /** Consumes a delimited group at the cursor and returns its inner token trees. */
  parseDelimited(): { delim: "(" | "[" | "{"; tokens: TokenTree[]; end: number } {
    const open = this.tok;
    if (open.kind !== "open") this.error("expected `(`, `[`, or `{`");
    const closeIdx = this.matchingClose(this.pos);
    const tokens = buildTokenTrees(this.tokens, this.pos + 1, closeIdx);
    this.pos = closeIdx + 1;
    return { delim: open.text as "(" | "[" | "{", tokens, end: this.tokens[closeIdx].end };
  }

  // -- attributes -----------------------------------------------------------

  parseOuterAttrs(): ast.Attribute[] {
    const attrs: ast.Attribute[] = [];
    while (this.isChar("#") && this.isOpen("[", 1)) attrs.push(this.parseAttr("outer"));
    return attrs;
  }

  parseInnerAttrs(): ast.Attribute[] {
    const attrs: ast.Attribute[] = [];
    while (this.isChar("#") && this.isChar("!", 1) && this.isOpen("[", 2)) attrs.push(this.parseAttr("inner"));
    return attrs;
  }

  private parseAttr(style: "outer" | "inner"): ast.Attribute {
    const start = this.tok.start;
    this.expectChar("#");
    if (style === "inner") this.expectChar("!");
    this.expectOpen("[");
    const path = this.parseAttrPath();
    let delim: ast.Attribute["delim"] = null;
    let tokens: TokenTree[] | null = null;
    let value: ast.Expr | null = null;
    if (this.tok.kind === "open") {
      const group = this.parseDelimited();
      delim = group.delim;
      tokens = group.tokens;
    } else if (this.isOp("=")) {
      this.pos++;
      value = this.parseExpr();
    }
    const close = this.expectClose("]");
    const name = path.segments.map(s => s.name).join("::");
    let meta: ast.Meta;
    if (value !== null) {
      meta = { kind: "MetaNameValue", path: name, value: this.src.slice(value.start, value.end), expr: value };
    } else if (tokens !== null) {
      meta = { kind: "MetaList", path: name, items: this.parseMetaItems(tokens) };
    } else {
      meta = { kind: "MetaPath", path: name };
    }
    return { kind: "Attribute", style, path, name, delim, tokens, value, meta, start, end: close.end };
  }

  /** Implemented by the expression layer: meta items from attribute argument tokens. */
  protected abstract parseMetaItems(tokens: TokenTree[]): ast.Meta[];

  /** Attribute paths accept keywords as segments (`#[unsafe(no_mangle)]`). */
  private parseAttrPath(): ast.Path {
    const start = this.tok.start;
    const global = this.eatOp("::");
    const segments: ast.PathSegment[] = [];
    for (;;) {
      const t = this.tok;
      if (t.kind !== "ident") this.error("expected attribute name");
      this.pos++;
      segments.push({ kind: "PathSegment", name: t.text, args: null, start: t.start, end: t.end });
      if (!this.isOp("::")) break;
      this.pos += 2;
    }
    return { kind: "Path", global, qself: null, asTrait: null, segments, start, end: this.prevEnd() };
  }

  // -- paths ----------------------------------------------------------------

  /**
   * Parses a path.
   * - "expr": generic arguments need a turbofish (`::<`); used in expressions and patterns.
   * - "type": `Foo<T>`, `Foo::<T>`, and `Fn(A) -> B` sugar are all accepted.
   * - "mod": no generic arguments (`use`, visibility).
   */
  parsePath(mode: "expr" | "type" | "mod"): ast.Path {
    const start = this.tok.start;
    let qself: ast.Type | null = null;
    let asTrait: ast.Path | null = null;
    let global = false;
    if (this.isChar("<")) {
      this.pos++;
      qself = this.parseType();
      if (this.eatKw("as")) asTrait = this.parsePath("type");
      this.expectChar(">");
      this.expectOp("::");
    } else {
      global = this.eatOp("::");
    }
    const segments: ast.PathSegment[] = [];
    for (;;) {
      const t = this.tok;
      if (!this.isPathStartIdent()) this.error("expected path segment");
      this.pos++;
      let args: ast.AngleArgs | ast.ParenArgs | null = null;
      if (this.isOp("::") && this.isChar("<", 2)) {
        this.pos += 2;
        args = this.parseAngleArgs(true);
      } else if (mode === "type") {
        // Like rustc: `<` and `<<` open generic arguments, `<=` and `<<=` do
        // not, so `x as usize <= y` parses as a comparison.
        const op = this.peekOp();
        if (op === "<" || op === "<<") {
          args = this.parseAngleArgs(false);
        } else if (this.isOpen("(")) {
          args = this.parseParenArgs();
        }
      }
      segments.push({ kind: "PathSegment", name: t.text, args, start: t.start, end: this.prevEnd() });
      if (this.isOp("::") && this.isPathStartIdent(2)) {
        this.pos += 2;
        continue;
      }
      break;
    }
    return { kind: "Path", global, qself, asTrait, segments, start, end: this.prevEnd() };
  }

  /** `(A, B) -> C` after a path segment (`Fn`, `FnMut`, `FnOnce` sugar). */
  private parseParenArgs(): ast.ParenArgs {
    const start = this.tok.start;
    this.expectOpen("(");
    const inputs: ast.Type[] = [];
    while (!this.isClose(")")) {
      inputs.push(this.parseType());
      if (!this.eatChar(",")) break;
    }
    this.expectClose(")");
    let output: ast.Type | null = null;
    if (this.eatOp("->")) output = this.parseTypeNoBounds();
    return { kind: "ParenArgs", inputs, output, start, end: this.prevEnd() };
  }

  // -- visibility -----------------------------------------------------------

  /** Normalized spelling: `pub`, `pub(crate)`, `pub(super)`, `pub(self)`, `pub(in a::b)`. */
  parseVisibility(): ast.Visibility {
    if (!this.isKw("pub")) return null;
    this.pos++;
    if (!this.isOpen("(")) return "pub";
    // `pub(crate)`, `pub(super)`, `pub(self)`, `pub(in path)`. Anything else
    // after `pub (` is a tuple struct field type: `pub (u8, u8)`.
    const t1 = this.peek(1);
    if (
      t1.kind === "ident" &&
      (t1.text === "crate" || t1.text === "super" || t1.text === "self") &&
      this.isClose(")", 2)
    ) {
      this.pos += 3;
      return `pub(${t1.text})`;
    }
    if (t1.kind === "ident" && t1.text === "in") {
      this.pos += 2;
      const path = this.parsePath("mod");
      this.expectClose(")");
      return `pub(in ${(path.global ? "::" : "") + path.segments.map(s => s.name).join("::")})`;
    }
    return "pub";
  }

  // -- literals -------------------------------------------------------------

  /** Consumes the literal (or `true`/`false`) at the cursor. */
  parseLit(): ast.Lit {
    const t = this.tok;
    if (t.kind === "ident" && (t.text === "true" || t.text === "false")) {
      this.pos++;
      return { kind: "Lit", litKind: "bool", text: t.text, suffix: null, start: t.start, end: t.end };
    }
    if (t.kind !== "literal") this.error("expected literal");
    this.pos++;
    return { kind: "Lit", litKind: t.lit!, text: t.text, suffix: t.suffix, start: t.start, end: t.end };
  }

  // -- lifetimes ------------------------------------------------------------

  parseLifetime(): ast.Lifetime {
    const t = this.tok;
    if (t.kind !== "lifetime") this.error("expected lifetime");
    this.pos++;
    return { kind: "Lifetime", name: t.text, start: t.start, end: t.end };
  }
}
