// Items and the file root. `Parser` is the concrete class.

import type * as ast from "./ast.ts";
import { flattenTokenTrees, lex, RustLexError, type Token, type TokenTree } from "./lexer.ts";
import { RustParseError, STRICT_KEYWORDS } from "./parser-base.ts";
import { ExprParser } from "./parser-exprs.ts";

/** Keywords a `default`/`const`/`async`/`unsafe`/`safe` qualifier may be followed by in item position. */
const QUALIFIED_ITEM_KEYWORDS = new Set([
  "fn",
  "unsafe",
  "safe",
  "const",
  "async",
  "extern",
  "impl",
  "trait",
  "type",
  "static",
  "mod",
  "default",
]);

export class Parser extends ExprParser {
  protected subParser(tokens: Token[]): Parser {
    return new Parser(tokens, this.src, this.path);
  }

  // -- file -----------------------------------------------------------------

  parseFile(): ast.File {
    const attrs = this.parseInnerAttrs();
    const items = this.parseItemsUntilClose();
    if (!this.atEof()) this.error("expected item");
    return { kind: "File", attrs, items, start: 0, end: this.src.length };
  }

  private parseItemsUntilClose(): ast.Item[] {
    const items: ast.Item[] = [];
    while (!this.atEof() && this.tok.kind !== "close") {
      items.push(this.parseItem(this.parseOuterAttrs()));
    }
    return items;
  }

  // -- item dispatch --------------------------------------------------------

  /** Whether the cursor (after any attributes) is at the start of an item rather than an expression. */
  isItemStart(): boolean {
    const t = this.tok;
    if (t.kind !== "ident") return false;
    switch (t.text) {
      case "fn":
      case "struct":
      case "enum":
      case "trait":
      case "impl":
      case "mod":
      case "use":
      case "type":
      case "extern":
      case "pub":
        return true;
      case "static":
        // `static || ...` is a coroutine closure.
        return !this.isChar("|", 1) && !this.isKw("move", 1);
      case "const":
        return !this.isOpen("{", 1);
      case "unsafe":
        return !this.isOpen("{", 1);
      case "async":
        return this.isKw("fn", 1) || this.isKw("unsafe", 1);
      case "safe":
        return this.isKw("fn", 1) || this.isKw("static", 1);
      case "auto":
        return this.isKw("trait", 1);
      case "default": {
        const t1 = this.peek(1);
        return t1.kind === "ident" && QUALIFIED_ITEM_KEYWORDS.has(t1.text);
      }
      case "union":
        return this.isIdent(1) && (this.isOpen("{", 2) || this.isChar("<", 2));
      case "macro_rules":
        return this.isChar("!", 1);
    }
    return false;
  }

  parseItem(attrs: ast.Attribute[]): ast.Item {
    const start = this.tok.start;
    const vis = this.parseVisibility();
    const t = this.tok;

    if (t.kind === "ident") {
      switch (t.text) {
        case "use":
          return this.parseUse(attrs, vis, start);
        case "struct":
          return this.parseStruct(attrs, vis, start);
        case "enum":
          return this.parseEnum(attrs, vis, start);
        case "union":
          if (this.isIdent(1)) return this.parseUnion(attrs, vis, start);
          break;
        case "mod":
          return this.parseMod(attrs, vis, false, start);
        case "type":
          return this.parseTypeAlias(attrs, vis, false, start);
        case "static":
          return this.parseStatic(attrs, vis, false, false, start);
        case "macro_rules":
          if (this.isChar("!", 1)) return this.parseMacroRules(attrs, start);
          break;
        case "auto":
          if (this.isKw("trait", 1)) {
            this.pos++;
            return this.parseTrait(attrs, vis, false, true, start);
          }
          break;
        case "trait":
          return this.parseTrait(attrs, vis, false, false, start);
        case "impl":
          return this.parseImpl(attrs, false, false, start);
        case "fn":
        case "const":
        case "async":
        case "unsafe":
        case "safe":
        case "default":
        case "extern":
          return this.parseQualifiedItem(attrs, vis, start);
      }
    }

    // Macro invocation in item position: `path!(...)`, `path! { ... }`.
    if (this.isPathStartIdent() || this.isOp("::")) {
      const path = this.parsePath("mod");
      if (!this.isChar("!") || this.peek(1).kind !== "open") this.error("expected `!` for macro invocation");
      const mac = this.parseMacroAfterPath(path, attrs);
      if (mac.delim !== "{") this.eatChar(";");
      return mac;
    }
    return this.error("expected item");
  }

  /** Items that begin with `const`/`async`/`unsafe`/`safe`/`default`/`extern` qualifiers. */
  private parseQualifiedItem(attrs: ast.Attribute[], vis: ast.Visibility, start: number): ast.Item {
    let isConst = false;
    let isAsync = false;
    let isUnsafe = false;
    let isSafe = false;
    let isDefault = false;
    let abi: string | null = null;
    for (;;) {
      const t = this.tok;
      if (t.kind !== "ident") break;
      if (t.text === "const" && this.peek(1).kind === "ident" && QUALIFIED_ITEM_KEYWORDS.has(this.peek(1).text)) {
        this.pos++;
        isConst = true;
      } else if (t.text === "async" && (this.isKw("fn", 1) || this.isKw("unsafe", 1))) {
        this.pos++;
        isAsync = true;
      } else if (t.text === "unsafe") {
        this.pos++;
        isUnsafe = true;
      } else if (t.text === "safe" && (this.isKw("fn", 1) || this.isKw("static", 1))) {
        this.pos++;
        isSafe = true;
      } else if (
        t.text === "default" &&
        this.peek(1).kind === "ident" &&
        QUALIFIED_ITEM_KEYWORDS.has(this.peek(1).text)
      ) {
        this.pos++;
        isDefault = true;
      } else if (t.text === "extern") {
        if (this.isKw("crate", 1)) return this.parseExternCrate(attrs, vis, start);
        this.pos++;
        abi = "";
        if (this.tok.kind === "literal" && this.tok.lit === "str") abi = this.next().text.slice(1, -1);
        if (this.isOpen("{")) return this.parseForeignMod(attrs, isUnsafe, abi, start);
      } else {
        break;
      }
    }
    switch (this.tok.text) {
      case "fn":
        return this.parseFn(attrs, vis, { isConst, isAsync, isUnsafe, isSafe, isDefault, abi }, start);
      case "impl":
        return this.parseImpl(attrs, isUnsafe, isDefault, start);
      case "trait":
        return this.parseTrait(attrs, vis, isUnsafe, false, start);
      case "const":
        return this.parseConst(attrs, vis, isDefault, start);
      case "static":
        return this.parseStatic(attrs, vis, isSafe, isUnsafe, start);
      case "type":
        return this.parseTypeAlias(attrs, vis, isDefault, start);
      case "mod":
        return this.parseMod(attrs, vis, isUnsafe, start);
      case "auto":
        this.pos++;
        return this.parseTrait(attrs, vis, isUnsafe, true, start);
    }
    return this.error("expected item");
  }

  // -- functions ------------------------------------------------------------

  private parseFn(
    attrs: ast.Attribute[],
    vis: ast.Visibility,
    q: {
      isConst: boolean;
      isAsync: boolean;
      isUnsafe: boolean;
      isSafe: boolean;
      isDefault: boolean;
      abi: string | null;
    },
    start: number,
  ): ast.Fn {
    this.expectKw("fn");
    const name = this.expectIdent();
    const generics = this.parseGenerics();
    this.expectOpen("(");
    const params: ast.FnParam[] = [];
    let variadic = false;
    while (!this.isClose(")")) {
      const pAttrs = this.parseOuterAttrs();
      const pStart = this.tok.start;
      if (this.isOp("...")) {
        this.pos += 3;
        variadic = true;
        break;
      }
      if (
        (this.isIdent() || this.isUnderscore()) &&
        this.isChar(":", 1) &&
        !this.isOp("::", 1) &&
        this.isOp("...", 2)
      ) {
        // `args: ...` named variadic.
        this.pos += 5;
        variadic = true;
        break;
      }
      const receiver = this.tryParseReceiver(pAttrs, pStart);
      if (receiver) {
        params.push(receiver);
      } else {
        params.push(this.parseParam(pAttrs, pStart));
      }
      if (!this.eatChar(",")) break;
    }
    this.expectClose(")");
    let ret: ast.Type | null = null;
    if (this.eatOp("->")) ret = this.parseType();
    this.parseWhere(generics);
    let body: ast.Block | null = null;
    if (this.isOpen("{")) body = this.parseBlock();
    else this.expectChar(";");
    return {
      kind: "Fn",
      attrs,
      vis,
      const: q.isConst,
      async: q.isAsync,
      unsafe: q.isUnsafe,
      safe: q.isSafe,
      default: q.isDefault,
      abi: q.abi,
      name,
      generics,
      params,
      variadic,
      ret,
      body,
      start,
      end: this.prevEnd(),
    };
  }

  /** `self`, `mut self`, `&self`, `&'a mut self`, `self: Type`, `mut self: Type`. */
  private tryParseReceiver(attrs: ast.Attribute[], start: number): ast.Receiver | null {
    let k = 0;
    let ref = false;
    let lifetime: ast.Lifetime | null = null;
    let mutable = false;
    if (this.isChar("&")) {
      ref = true;
      k++;
      if (this.isLifetime(k)) k++;
      if (this.isKw("mut", k)) {
        mutable = true;
        k++;
      }
      if (!this.isKw("self", k)) return null;
    } else if (this.isKw("mut") && this.isKw("self", 1)) {
      mutable = true;
      k = 1;
    } else if (!this.isKw("self")) {
      return null;
    }
    // A `self` that is followed by `::` is a path, not a receiver.
    if (this.isOp("::", k + 1)) return null;
    if (ref) {
      this.pos++;
      if (this.isLifetime()) lifetime = this.parseLifetime();
      if (mutable) this.pos++;
    } else if (mutable) {
      this.pos++;
    }
    this.expectKw("self");
    let ty: ast.Type | null = null;
    if (!ref && this.eatChar(":")) ty = this.parseType();
    return { kind: "Receiver", attrs, ref, lifetime, mutable, ty, start, end: this.prevEnd() };
  }

  /** `pat: Type`, or a bare `Type` for unnamed parameters. */
  private parseParam(attrs: ast.Attribute[], start: number): ast.Param {
    const saved = this.pos;
    let pat: ast.Pat | null = null;
    try {
      pat = this.parsePatNoOr();
      if (!this.isChar(":") || this.isOp("::")) {
        pat = null;
        this.pos = saved;
      }
    } catch (e) {
      if (!(e instanceof RustParseError)) throw e;
      pat = null;
      this.pos = saved;
    }
    if (pat) this.pos++;
    const ty = this.parseType();
    return { kind: "Param", attrs, pat, ty, start, end: ty.end };
  }

  // -- structs, enums, unions -----------------------------------------------

  private parseStruct(attrs: ast.Attribute[], vis: ast.Visibility, start: number): ast.Struct {
    this.expectKw("struct");
    const name = this.expectIdent();
    const generics = this.parseGenerics();
    let fields: ast.StructField[] | null = null;
    let tuple = false;
    if (this.isOpen("(")) {
      tuple = true;
      fields = this.parseTupleFields();
      this.parseWhere(generics);
      this.expectChar(";");
    } else {
      this.parseWhere(generics);
      if (this.eatChar(";")) {
        fields = null;
      } else {
        fields = this.parseNamedFields();
      }
    }
    return { kind: "Struct", attrs, vis, name, generics, fields, tuple, start, end: this.prevEnd() };
  }

  private parseUnion(attrs: ast.Attribute[], vis: ast.Visibility, start: number): ast.Union {
    this.expectKw("union");
    const name = this.expectIdent();
    const generics = this.parseGenerics();
    this.parseWhere(generics);
    const fields = this.parseNamedFields();
    return { kind: "Union", attrs, vis, name, generics, fields, start, end: this.prevEnd() };
  }

  private parseEnum(attrs: ast.Attribute[], vis: ast.Visibility, start: number): ast.Enum {
    this.expectKw("enum");
    const name = this.expectIdent();
    const generics = this.parseGenerics();
    this.parseWhere(generics);
    this.expectOpen("{");
    const variants: ast.Variant[] = [];
    while (!this.isClose("}")) {
      const vAttrs = this.parseOuterAttrs();
      const vStart = this.tok.start;
      this.parseVisibility();
      const vName = this.expectIdent();
      let fields: ast.StructField[] | null = null;
      let tuple = false;
      if (this.isOpen("(")) {
        tuple = true;
        fields = this.parseTupleFields();
      } else if (this.isOpen("{")) {
        fields = this.parseNamedFields();
      }
      let discriminant: ast.Expr | null = null;
      if (this.isOp("=")) {
        this.pos++;
        discriminant = this.parseExpr();
      }
      variants.push({
        kind: "Variant",
        attrs: vAttrs,
        name: vName,
        fields,
        tuple,
        discriminant,
        start: vStart,
        end: this.prevEnd(),
      });
      if (!this.eatChar(",")) break;
    }
    this.expectClose("}");
    return { kind: "Enum", attrs, vis, name, generics, variants, start, end: this.prevEnd() };
  }

  private parseNamedFields(): ast.StructField[] {
    this.expectOpen("{");
    const fields: ast.StructField[] = [];
    while (!this.isClose("}")) {
      const attrs = this.parseOuterAttrs();
      const start = this.tok.start;
      const vis = this.parseVisibility();
      const name = this.isUnderscore() ? this.next().text : this.expectIdent();
      this.expectChar(":");
      const ty = this.parseType();
      // `field: Type = default` (unstable default field values).
      if (this.isOp("=")) {
        this.pos++;
        this.parseExpr();
      }
      fields.push({ kind: "StructField", attrs, vis, name, ty, start, end: this.prevEnd() });
      if (!this.eatChar(",")) break;
    }
    this.expectClose("}");
    return fields;
  }

  private parseTupleFields(): ast.StructField[] {
    this.expectOpen("(");
    const fields: ast.StructField[] = [];
    while (!this.isClose(")")) {
      const attrs = this.parseOuterAttrs();
      const start = this.tok.start;
      const vis = this.parseVisibility();
      const ty = this.parseType();
      fields.push({ kind: "StructField", attrs, vis, name: null, ty, start, end: ty.end });
      if (!this.eatChar(",")) break;
    }
    this.expectClose(")");
    return fields;
  }

  // -- traits and impls -----------------------------------------------------

  private parseTrait(
    attrs: ast.Attribute[],
    vis: ast.Visibility,
    unsafe: boolean,
    auto: boolean,
    start: number,
  ): ast.Trait {
    this.expectKw("trait");
    const name = this.expectIdent();
    const generics = this.parseGenerics();
    let supertraits: ast.Bound[] = [];
    if (this.eatChar(":")) supertraits = this.parseBounds();
    this.parseWhere(generics);
    this.expectOpen("{");
    attrs = attrs.concat(this.parseInnerAttrs());
    const items = this.parseItemsUntilClose();
    this.expectClose("}");
    return { kind: "Trait", attrs, vis, unsafe, auto, name, generics, supertraits, items, start, end: this.prevEnd() };
  }

  private parseImpl(attrs: ast.Attribute[], unsafe: boolean, isDefault: boolean, start: number): ast.Impl {
    this.expectKw("impl");
    const generics = this.implHasGenerics()
      ? this.parseGenerics()
      : ({ kind: "Generics", params: [], where: [], start: this.tok.start, end: this.tok.start } as ast.Generics);
    let isConst = false;
    if (this.isKw("const") && !this.isOpen("{", 1)) {
      this.pos++;
      isConst = true;
    }
    const negative = this.eatChar("!");
    let trait: ast.Path | null = null;
    let selfTy = this.parseType();
    if (this.eatKw("for")) {
      if (selfTy.kind !== "TypePath") this.error("expected trait path before `for`");
      trait = selfTy.path;
      selfTy = this.parseType();
    }
    this.parseWhere(generics);
    this.expectOpen("{");
    attrs = attrs.concat(this.parseInnerAttrs());
    const items = this.parseItemsUntilClose();
    this.expectClose("}");
    return {
      kind: "Impl",
      attrs,
      unsafe,
      default: isDefault,
      const: isConst,
      generics,
      negative,
      trait,
      selfTy,
      items,
      start,
      end: this.prevEnd(),
    };
  }

  /**
   * After `impl`, a `<` opens generic parameters (`impl<T: Tr, 'a, const N: usize>`)
   * unless it opens a qualified self type (`impl <Vec<T> as Tr>::Out`). A
   * parameter list starts with a lifetime, `const`, an attribute, `>` (empty),
   * or an identifier followed by `:`, `,`, `=`, or `>`.
   */
  private implHasGenerics(): boolean {
    if (!this.isChar("<")) return false;
    const t1 = this.peek(1);
    if (t1.kind === "lifetime" || this.isKw("const", 1) || this.isChar("#", 1) || this.isChar(">", 1)) return true;
    if (t1.kind !== "ident" || STRICT_KEYWORDS.has(t1.text)) return false;
    // `peekOp` sees `::` whole, so `impl <a::B as Tr>::Out` is a self type.
    const op = this.peekOp(2);
    return op === ":" || op === "," || op === "=" || op === ">";
  }

  // -- modules, use, extern -------------------------------------------------

  private parseMod(attrs: ast.Attribute[], vis: ast.Visibility, unsafe: boolean, start: number): ast.Mod {
    this.expectKw("mod");
    const name = this.expectIdent();
    let items: ast.Item[] | null = null;
    if (this.eatOpen("{")) {
      attrs = attrs.concat(this.parseInnerAttrs());
      items = this.parseItemsUntilClose();
      this.expectClose("}");
    } else {
      this.expectChar(";");
    }
    return { kind: "Mod", attrs, vis, unsafe, name, items, start, end: this.prevEnd() };
  }

  private parseUse(attrs: ast.Attribute[], vis: ast.Visibility, start: number): ast.Use {
    this.expectKw("use");
    const global = this.eatOp("::");
    const tree = this.parseUseTree();
    this.expectChar(";");
    return { kind: "Use", attrs, vis, global, tree, start, end: this.prevEnd() };
  }

  private parseUseTree(): ast.UseTree {
    const t = this.tok;
    const start = t.start;
    if (this.isChar("*")) {
      this.pos++;
      return { kind: "UseGlob", start, end: t.end };
    }
    if (this.isOpen("{")) {
      this.pos++;
      const items: ast.UseTree[] = [];
      while (!this.isClose("}")) {
        items.push(this.parseUseTree());
        if (!this.eatChar(",")) break;
      }
      const close = this.expectClose("}");
      return { kind: "UseGroup", items, start, end: close.end };
    }
    if (t.kind !== "ident") this.error("expected use path");
    this.pos++;
    if (this.isOp("::")) {
      this.pos += 2;
      const tree = this.parseUseTree();
      return { kind: "UsePath", name: t.text, tree, start, end: tree.end };
    }
    if (this.eatKw("as")) {
      const rename = this.next();
      return { kind: "UseRename", name: t.text, rename: rename.text, start, end: rename.end };
    }
    return { kind: "UseName", name: t.text, start, end: t.end };
  }

  private parseExternCrate(attrs: ast.Attribute[], vis: ast.Visibility, start: number): ast.ExternCrate {
    this.expectKw("extern");
    this.expectKw("crate");
    const name = this.next().text;
    let rename: string | null = null;
    if (this.eatKw("as")) rename = this.next().text;
    this.expectChar(";");
    return { kind: "ExternCrate", attrs, vis, name, rename, start, end: this.prevEnd() };
  }

  private parseForeignMod(attrs: ast.Attribute[], unsafe: boolean, abi: string, start: number): ast.ForeignMod {
    this.expectOpen("{");
    attrs = attrs.concat(this.parseInnerAttrs());
    const items = this.parseItemsUntilClose();
    this.expectClose("}");
    return { kind: "ForeignMod", attrs, unsafe, abi, items, start, end: this.prevEnd() };
  }

  // -- const, static, type --------------------------------------------------

  private parseConst(attrs: ast.Attribute[], vis: ast.Visibility, isDefault: boolean, start: number): ast.Const {
    this.expectKw("const");
    const name = this.isUnderscore() ? this.next().text : this.expectIdent();
    const generics = this.parseGenerics();
    let ty: ast.Type | null = null;
    if (this.eatChar(":")) ty = this.parseType();
    let expr: ast.Expr | null = null;
    if (this.isOp("=")) {
      this.pos++;
      expr = this.parseExpr();
    }
    this.parseWhere(generics);
    this.expectChar(";");
    return { kind: "Const", attrs, vis, default: isDefault, name, generics, ty, expr, start, end: this.prevEnd() };
  }

  private parseStatic(
    attrs: ast.Attribute[],
    vis: ast.Visibility,
    safe: boolean,
    unsafe: boolean,
    start: number,
  ): ast.Static {
    this.expectKw("static");
    const mutable = this.eatKw("mut");
    const name = this.expectIdent();
    this.expectChar(":");
    const ty = this.parseType();
    let expr: ast.Expr | null = null;
    if (this.isOp("=")) {
      this.pos++;
      expr = this.parseExpr();
    }
    this.expectChar(";");
    return { kind: "Static", attrs, vis, mutable, safe, unsafe, name, ty, expr, start, end: this.prevEnd() };
  }

  private parseTypeAlias(
    attrs: ast.Attribute[],
    vis: ast.Visibility,
    isDefault: boolean,
    start: number,
  ): ast.TypeAlias {
    this.expectKw("type");
    const name = this.expectIdent();
    const generics = this.parseGenerics();
    let bounds: ast.Bound[] = [];
    if (this.eatChar(":")) bounds = this.parseBounds();
    this.parseWhere(generics);
    let ty: ast.Type | null = null;
    if (this.isOp("=")) {
      this.pos++;
      ty = this.parseType();
    }
    this.parseWhere(generics);
    this.expectChar(";");
    return {
      kind: "TypeAlias",
      attrs,
      vis,
      default: isDefault,
      name,
      generics,
      bounds,
      ty,
      start,
      end: this.prevEnd(),
    };
  }

  // -- macro_rules ----------------------------------------------------------

  private parseMacroRules(attrs: ast.Attribute[], start: number): ast.MacroRules {
    this.expectKw("macro_rules");
    this.expectChar("!");
    const name = this.expectIdent();
    const { delim, tokens } = this.parseDelimited();
    if (delim !== "{") this.eatChar(";");
    return { kind: "MacroRules", attrs, name, delim, tokens, start, end: this.prevEnd() };
  }
}

// ---------------------------------------------------------------------------
// Entry points

export interface ParseOptions {
  /** File path, used in error messages. */
  path?: string;
}

export interface ParsedFile {
  ast: ast.File;
  comments: ast.Comment[];
}

function makeParser(src: string, path: string | undefined): { parser: Parser; comments: ast.Comment[] } {
  try {
    const { tokens, comments } = lex(src);
    return { parser: new Parser(tokens, src, path), comments };
  } catch (e) {
    if (e instanceof RustLexError) throw new RustParseError(e.message, e.offset, path);
    throw e;
  }
}

/** Parses a whole Rust source file. */
export function parseFile(src: string, options: ParseOptions = {}): ParsedFile {
  const { parser, comments } = makeParser(src, options.path);
  return { ast: parser.parseFile(), comments };
}

/** Parses a single expression. The whole input must be consumed. */
export function parseExpr(src: string, options: ParseOptions = {}): ast.Expr {
  const { parser } = makeParser(src, options.path);
  const expr = parser.parseExpr();
  if (!parser.atEof()) parser.error("expected end of expression");
  return expr;
}

/** Parses a single type. */
export function parseType(src: string, options: ParseOptions = {}): ast.Type {
  const { parser } = makeParser(src, options.path);
  const ty = parser.parseType();
  if (!parser.atEof()) parser.error("expected end of type");
  return ty;
}

/** Parses a single pattern. */
export function parsePat(src: string, options: ParseOptions = {}): ast.Pat {
  const { parser } = makeParser(src, options.path);
  const pat = parser.parsePat();
  if (!parser.atEof()) parser.error("expected end of pattern");
  return pat;
}

/**
 * Parses a sequence of statements (a function body without its braces). Items
 * and a trailing expression without `;` are accepted.
 */
export function parseStmts(src: string, options: ParseOptions = {}): ParsedBlock {
  const wrapped = "{" + src + "\n}";
  const { parser, comments } = makeParser(wrapped, options.path);
  const block = parser.parseBlock();
  if (!parser.atEof()) parser.error("expected end of input");
  // Shift spans back by the added brace so they index into `src`.
  shiftSpans(block, -1);
  for (const c of comments) {
    c.start -= 1;
    c.end -= 1;
  }
  block.start = 0;
  block.end = src.length;
  return { block, comments };
}

export interface ParsedBlock {
  block: ast.Block;
  comments: ast.Comment[];
}

/**
 * Attributes spelled inside token trees: `#[...]` and `#![...]` in macro
 * input or in a `macro_rules!` body. Nested groups are searched. Sequences
 * that do not parse as an attribute are skipped.
 */
export function attributesInTokens(trees: TokenTree[], src: string, path?: string): ast.Attribute[] {
  const out: ast.Attribute[] = [];
  const visit = (list: TokenTree[]) => {
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (t.kind === "group") {
        visit(t.trees);
        continue;
      }
      if (t.kind !== "punct" || t.text !== "#") continue;
      let j = i + 1;
      const bang = list[j];
      const inner = bang !== undefined && bang.kind === "punct" && bang.text === "!";
      if (inner) j++;
      const group = list[j];
      if (group === undefined || group.kind !== "group" || group.delim !== "[") continue;
      const parser = new Parser(flattenTokenTrees(list.slice(i, j + 1), group.end), src, path);
      try {
        const attrs = inner ? parser.parseInnerAttrs() : parser.parseOuterAttrs();
        if (attrs.length === 1 && parser.atEof()) out.push(attrs[0]);
      } catch (e) {
        if (!(e instanceof RustParseError)) throw e;
      }
      i = j;
    }
  };
  visit(trees);
  return out;
}

/**
 * Moves every span in the tree by `delta`. Some objects are reachable twice
 * (`Attribute.value` is also `meta.expr`, a `MetaTokens` item shares its
 * token trees with `Attribute.tokens`), so each is shifted once.
 */
function shiftSpans(root: unknown, delta: number): void {
  const seen = new Set<object>();
  const visit = (node: unknown) => {
    if (node === null || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const n of node) visit(n);
      return;
    }
    const o = node as Record<string, unknown>;
    if (typeof o.start === "number") o.start += delta;
    if (typeof o.end === "number") o.end += delta;
    for (const key in o) {
      if (key === "start" || key === "end") continue;
      visit(o[key]);
    }
  };
  visit(root);
}
