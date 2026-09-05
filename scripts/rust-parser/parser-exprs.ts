// Expressions, blocks, and statements.

import type * as ast from "./ast.ts";
import { flattenTokenTrees, splitTokenTrees, type Token, type TokenTree } from "./lexer.ts";
import { RustParseError } from "./parser-base.ts";
import { PatParser } from "./parser-pats.ts";

const PREC_ASSIGN = 1;
const PREC_RANGE = 2;
const PREC_OR = 3;
const PREC_AND = 4;
const PREC_CMP = 5;
const PREC_BITOR = 6;
const PREC_BITXOR = 7;
const PREC_BITAND = 8;
const PREC_SHIFT = 9;
const PREC_ADD = 10;
const PREC_MUL = 11;
const PREC_CAST = 12;

function binaryPrec(op: string): number {
  switch (op) {
    case "=":
    case "+=":
    case "-=":
    case "*=":
    case "/=":
    case "%=":
    case "^=":
    case "&=":
    case "|=":
    case "<<=":
    case ">>=":
      return PREC_ASSIGN;
    case "..":
    case "..=":
      return PREC_RANGE;
    case "||":
      return PREC_OR;
    case "&&":
      return PREC_AND;
    case "==":
    case "!=":
    case "<":
    case ">":
    case "<=":
    case ">=":
      return PREC_CMP;
    case "|":
      return PREC_BITOR;
    case "^":
      return PREC_BITXOR;
    case "&":
      return PREC_BITAND;
    case "<<":
    case ">>":
      return PREC_SHIFT;
    case "+":
    case "-":
      return PREC_ADD;
    case "*":
    case "/":
    case "%":
      return PREC_MUL;
    default:
      return 0;
  }
}

/** Keywords that begin an expression. */
const EXPR_KEYWORDS = new Set([
  "self",
  "Self",
  "crate",
  "super",
  "true",
  "false",
  "if",
  "match",
  "loop",
  "while",
  "for",
  "unsafe",
  "async",
  "move",
  "return",
  "break",
  "continue",
  "let",
  "yield",
  "const",
  "static",
  "try",
]);

/** An expression whose statement form needs no trailing `;`. */
export function isBlockLike(expr: ast.Expr): boolean {
  switch (expr.kind) {
    case "BlockExpr":
    case "Unsafe":
    case "Async":
    case "ConstBlock":
    case "TryBlock":
    case "If":
    case "Match":
    case "While":
    case "Loop":
    case "ForLoop":
      return true;
    case "Macro":
      return expr.delim === "{";
    default:
      return false;
  }
}

export abstract class ExprParser extends PatParser {
  /** Implemented by the item layer. */
  abstract parseItem(attrs: ast.Attribute[]): ast.Item;
  abstract isItemStart(): boolean;

  /** Creates a parser over a token slice, for macro input. */
  protected abstract subParser(tokens: Token[]): ExprParser;

  // -- entry points ---------------------------------------------------------

  parseExpr(): ast.Expr {
    return this.parseExprBP(PREC_ASSIGN);
  }

  private parseExprBP(minPrec: number): ast.Expr {
    return this.parseBinaryRest(this.parsePrefix(), minPrec);
  }

  /** An expression in `if`/`while`/`match`/`for` head position (no struct literals). */
  private parseCond(): ast.Expr {
    const saved = this.noStruct;
    this.noStruct = true;
    const expr = this.parseExprBP(PREC_ASSIGN);
    this.noStruct = saved;
    return expr;
  }

  // -- binary operators -----------------------------------------------------

  private parseBinaryRest(lhs: ast.Expr, minPrec: number): ast.Expr {
    for (;;) {
      if (this.isKw("as")) {
        if (PREC_CAST < minPrec) break;
        this.pos++;
        const ty = this.parseTypeNoBounds();
        lhs = { kind: "Cast", expr: lhs, ty, start: lhs.start, end: ty.end };
        continue;
      }
      const op = this.peekOp();
      if (op === null) break;
      const prec = binaryPrec(op);
      if (prec === 0 || prec < minPrec) break;
      this.pos += op.length;
      if (prec === PREC_RANGE) {
        const hi = this.canBeginExpr() ? this.parseExprBP(PREC_RANGE + 1) : null;
        lhs = { kind: "Range", lo: lhs, hi, inclusive: op === "..=", start: lhs.start, end: this.prevEnd() };
        continue;
      }
      if (prec === PREC_ASSIGN) {
        const rhs = this.parseExprBP(PREC_ASSIGN);
        lhs =
          op === "="
            ? { kind: "Assign", left: lhs, right: rhs, start: lhs.start, end: rhs.end }
            : { kind: "AssignOp", op, left: lhs, right: rhs, start: lhs.start, end: rhs.end };
        continue;
      }
      const rhs = this.parseExprBP(prec + 1);
      lhs = { kind: "Binary", op: op as ast.BinaryOp, left: lhs, right: rhs, start: lhs.start, end: rhs.end };
    }
    return lhs;
  }

  /** Whether the token at the cursor can begin an expression (honours `noStruct`). */
  canBeginExpr(): boolean {
    const t = this.tok;
    switch (t.kind) {
      case "literal":
      case "lifetime":
        return true;
      case "ident":
        return this.isIdent() || t.text === "_" || EXPR_KEYWORDS.has(t.text);
      case "open":
        return t.text !== "{" || !this.noStruct;
      case "punct":
        switch (t.text) {
          case "-":
          case "!":
          case "*":
          case "&":
          case "|":
          case "<":
          case "#":
            return true;
          case ".":
            return this.isOp("..") || this.isOp("..=");
          case ":":
            return this.isOp("::");
        }
        return false;
      default:
        return false;
    }
  }

  // -- prefix operators -----------------------------------------------------

  private parsePrefix(): ast.Expr {
    const t = this.tok;
    const start = t.start;
    if (t.kind === "punct") {
      switch (t.text) {
        case "-":
        case "!":
        case "*": {
          this.pos++;
          const expr = this.parsePrefix();
          return { kind: "Unary", op: t.text, expr, start, end: expr.end };
        }
        case "&": {
          this.pos++;
          let raw = false;
          let mutable = false;
          if (this.isKw("raw") && (this.isKw("const", 1) || this.isKw("mut", 1))) {
            raw = true;
            this.pos++;
            mutable = this.next().text === "mut";
          } else if (this.eatKw("mut")) {
            mutable = true;
          }
          const expr = this.parsePrefix();
          return { kind: "Ref", mutable, raw, expr, start, end: expr.end };
        }
        case ".": {
          const op = this.peekOp();
          if (op === ".." || op === "..=") {
            this.pos += op.length;
            const hi = this.canBeginExpr() ? this.parseExprBP(PREC_RANGE + 1) : null;
            return { kind: "Range", lo: null, hi, inclusive: op === "..=", start, end: this.prevEnd() };
          }
          break;
        }
      }
    }
    return this.parsePostfix(this.parsePrimary());
  }

  // -- postfix operators ----------------------------------------------------

  private parsePostfix(expr: ast.Expr): ast.Expr {
    for (;;) {
      const t = this.tok;
      if (t.kind === "punct") {
        if (t.text === "?") {
          this.pos++;
          expr = { kind: "Try", expr, start: expr.start, end: t.end };
          continue;
        }
        if (t.text === "." && this.peekOp() === ".") {
          this.pos++;
          expr = this.parseDotSuffix(expr);
          continue;
        }
        break;
      }
      if (t.kind === "open") {
        if (t.text === "(") {
          const args = this.parseCallArgs();
          expr = { kind: "Call", callee: expr, args, start: expr.start, end: this.prevEnd() };
          continue;
        }
        if (t.text === "[") {
          this.pos++;
          const saved = this.noStruct;
          this.noStruct = false;
          const index = this.parseExpr();
          this.noStruct = saved;
          const close = this.expectClose("]");
          expr = { kind: "Index", expr, index, start: expr.start, end: close.end };
          continue;
        }
      }
      break;
    }
    return expr;
  }

  /** After `.`: `.await`, `.field`, `.0`, `.method(args)`, `.method::<T>(args)`. */
  private parseDotSuffix(expr: ast.Expr): ast.Expr {
    const t = this.tok;
    if (t.kind === "ident") {
      if (t.text === "await") {
        this.pos++;
        return { kind: "Await", expr, start: expr.start, end: t.end };
      }
      this.pos++;
      let turbofish: ast.AngleArgs | null = null;
      if (this.isOp("::") && this.isChar("<", 2)) {
        this.pos += 2;
        turbofish = this.parseAngleArgs(true);
      }
      if (this.isOpen("(")) {
        const args = this.parseCallArgs();
        return {
          kind: "MethodCall",
          receiver: expr,
          method: t.text,
          turbofish,
          args,
          start: expr.start,
          end: this.prevEnd(),
        };
      }
      if (turbofish) this.error("expected `(` after turbofish");
      return { kind: "Field", expr, member: t.text, start: expr.start, end: t.end };
    }
    if (t.kind === "literal" && (t.lit === "int" || t.lit === "float")) {
      this.pos++;
      if (t.lit === "float") {
        // `x.0.1` lexes as `x` `.` `0.1`: two tuple-index accesses.
        const dot = t.text.indexOf(".");
        const first = t.text.slice(0, dot);
        const second = t.text.slice(dot + 1);
        expr = { kind: "Field", expr, member: first, start: expr.start, end: t.start + dot };
        if (second.length === 0) return expr;
        return { kind: "Field", expr, member: second, start: expr.start, end: t.end };
      }
      return { kind: "Field", expr, member: t.text, start: expr.start, end: t.end };
    }
    return this.error("expected field or method name");
  }

  private parseCallArgs(): ast.Expr[] {
    this.expectOpen("(");
    const saved = this.noStruct;
    this.noStruct = false;
    const args: ast.Expr[] = [];
    while (!this.isClose(")")) {
      args.push(this.parseExprWithAttrs());
      if (!this.eatChar(",")) break;
    }
    this.noStruct = saved;
    this.expectClose(")");
    return args;
  }

  /** An expression that may carry outer attributes (`#[cfg(x)] value`). */
  private parseExprWithAttrs(): ast.Expr {
    if (this.isChar("#") && this.isOpen("[", 1)) {
      const attrs = this.parseOuterAttrs();
      const expr = this.parseExpr();
      expr.attrs = attrs.concat(expr.attrs ?? []);
      return expr;
    }
    return this.parseExpr();
  }

  // -- primary expressions --------------------------------------------------

  private parsePrimary(): ast.Expr {
    const t = this.tok;
    const start = t.start;

    switch (t.kind) {
      case "literal":
        return this.parseLit();

      case "lifetime": {
        // Labeled loop or block: `'a: loop { ... }`.
        this.pos++;
        this.expectChar(":");
        const label = t.text;
        if (this.isKw("loop")) return this.parseLoop(label, start);
        if (this.isKw("while")) return this.parseWhile(label, start);
        if (this.isKw("for")) return this.parseFor(label, start);
        if (this.isOpen("{")) {
          const block = this.parseBlock();
          return { kind: "BlockExpr", label, block, start, end: block.end };
        }
        return this.error("expected loop or block after label");
      }

      case "open":
        if (t.text === "(") return this.parseParenOrTuple();
        if (t.text === "[") return this.parseArray();
        if (t.text === "{") {
          const block = this.parseBlock();
          return { kind: "BlockExpr", label: null, block, start, end: block.end };
        }
        break;

      case "punct":
        if (t.text === "|") return this.parseClosure(false, false, false, start);
        if (t.text === "<" || (t.text === ":" && this.isOp("::"))) {
          return this.parsePathExprTail(this.parsePath("expr"), [], start);
        }
        if (t.text === "#" && this.isOpen("[", 1)) {
          const attrs = this.parseOuterAttrs();
          const expr = this.parsePrefix();
          expr.attrs = attrs.concat(expr.attrs ?? []);
          return expr;
        }
        break;

      case "ident":
        switch (t.text) {
          case "true":
          case "false":
            return this.parseLit();
          case "_":
            this.pos++;
            return { kind: "Infer", start, end: t.end };
          case "if":
            return this.parseIf();
          case "match":
            return this.parseMatch();
          case "loop":
            return this.parseLoop(null, start);
          case "while":
            return this.parseWhile(null, start);
          case "for":
            return this.parseFor(null, start);
          case "unsafe": {
            this.pos++;
            const block = this.parseBlock();
            return { kind: "Unsafe", block, start, end: block.end };
          }
          case "async": {
            this.pos++;
            if (this.isChar("|")) return this.parseClosure(true, false, false, start);
            if (this.isKw("move") && this.isChar("|", 1)) {
              this.pos++;
              return this.parseClosure(true, true, false, start);
            }
            const move = this.eatKw("move");
            const block = this.parseBlock();
            return { kind: "Async", move, block, start, end: block.end };
          }
          case "const":
            if (this.isOpen("{", 1)) {
              this.pos++;
              const block = this.parseBlock();
              return { kind: "ConstBlock", block, start, end: block.end };
            }
            break;
          case "try":
            if (this.isOpen("{", 1)) {
              this.pos++;
              const block = this.parseBlock();
              return { kind: "TryBlock", block, start, end: block.end };
            }
            break;
          case "move":
            this.pos++;
            return this.parseClosure(false, true, false, start);
          case "static":
            if (this.isChar("|", 1) || this.isKw("move", 1)) {
              this.pos++;
              const move = this.eatKw("move");
              return this.parseClosure(false, move, true, start);
            }
            break;
          case "return": {
            this.pos++;
            const expr = this.canBeginExpr() ? this.parseExpr() : null;
            return { kind: "Return", expr, start, end: this.prevEnd() };
          }
          case "yield": {
            this.pos++;
            const expr = this.canBeginExpr() ? this.parseExpr() : null;
            return { kind: "Yield", expr, start, end: this.prevEnd() };
          }
          case "break": {
            this.pos++;
            const label = this.isLifetime() ? this.next().text : null;
            const expr = this.canBeginExpr() ? this.parseExpr() : null;
            return { kind: "Break", label, expr, start, end: this.prevEnd() };
          }
          case "continue": {
            this.pos++;
            const label = this.isLifetime() ? this.next().text : null;
            return { kind: "Continue", label, start, end: this.prevEnd() };
          }
          case "let": {
            this.pos++;
            const pat = this.parsePat();
            this.expectOp("=");
            const expr = this.parseExprBP(PREC_AND + 1);
            return { kind: "Let", pat, expr, start, end: expr.end };
          }
        }
        if (this.isPathStartIdent()) {
          return this.parsePathExprTail(this.parsePath("expr"), [], start);
        }
        break;
    }
    return this.error("expected expression");
  }

  /** After a path in expression position: macro invocation, struct literal, or plain path. */
  private parsePathExprTail(path: ast.Path, attrs: ast.Attribute[], start: number): ast.Expr {
    if (this.isChar("!") && this.peek(1).kind === "open") {
      return this.parseMacroAfterPath(path, attrs);
    }
    if (this.isOpen("{") && !this.noStruct) {
      return this.parseStructExpr(path, start);
    }
    return { kind: "PathExpr", path, start, end: path.end };
  }

  private parseStructExpr(path: ast.Path, start: number): ast.StructExpr {
    this.expectOpen("{");
    const saved = this.noStruct;
    this.noStruct = false;
    const fields: ast.FieldValue[] = [];
    let rest: ast.Expr | null = null;
    let hasRest = false;
    while (!this.isClose("}")) {
      const attrs = this.parseOuterAttrs();
      const fStart = this.tok.start;
      if (this.isOp("..")) {
        this.pos += 2;
        hasRest = true;
        if (!this.isClose("}")) rest = this.parseExpr();
        this.eatChar(",");
        break;
      }
      const m = this.tok;
      if (m.kind !== "ident" && !(m.kind === "literal" && m.lit === "int")) this.error("expected field name");
      this.pos++;
      if (this.isChar(":") && !this.isOp("::")) {
        this.pos++;
        const expr = this.parseExpr();
        fields.push({
          kind: "FieldValue",
          attrs,
          member: m.text,
          expr,
          shorthand: false,
          start: fStart,
          end: expr.end,
        });
      } else {
        const seg: ast.PathSegment = { kind: "PathSegment", name: m.text, args: null, start: m.start, end: m.end };
        const p: ast.Path = {
          kind: "Path",
          global: false,
          qself: null,
          asTrait: null,
          segments: [seg],
          start: m.start,
          end: m.end,
        };
        const expr: ast.PathExpr = { kind: "PathExpr", path: p, start: m.start, end: m.end };
        fields.push({ kind: "FieldValue", attrs, member: m.text, expr, shorthand: true, start: fStart, end: m.end });
      }
      if (!this.eatChar(",")) break;
    }
    this.noStruct = saved;
    const close = this.expectClose("}");
    return { kind: "StructExpr", path, fields, rest, hasRest, start, end: close.end };
  }

  private parseParenOrTuple(): ast.Expr {
    const start = this.tok.start;
    this.expectOpen("(");
    const saved = this.noStruct;
    this.noStruct = false;
    const elems: ast.Expr[] = [];
    let trailingComma = false;
    while (!this.isClose(")")) {
      elems.push(this.parseExprWithAttrs());
      trailingComma = false;
      if (!this.eatChar(",")) break;
      trailingComma = true;
    }
    this.noStruct = saved;
    const close = this.expectClose(")");
    if (elems.length === 1 && !trailingComma) {
      return { kind: "Paren", expr: elems[0], start, end: close.end };
    }
    return { kind: "Tuple", elems, start, end: close.end };
  }

  private parseArray(): ast.Expr {
    const start = this.tok.start;
    this.expectOpen("[");
    const saved = this.noStruct;
    this.noStruct = false;
    const elems: ast.Expr[] = [];
    if (!this.isClose("]")) {
      const first = this.parseExprWithAttrs();
      if (this.eatChar(";")) {
        const len = this.parseExpr();
        this.noStruct = saved;
        const close = this.expectClose("]");
        return { kind: "Repeat", elem: first, len, start, end: close.end };
      }
      elems.push(first);
      while (this.eatChar(",")) {
        if (this.isClose("]")) break;
        elems.push(this.parseExprWithAttrs());
      }
    }
    this.noStruct = saved;
    const close = this.expectClose("]");
    return { kind: "Array", elems, start, end: close.end };
  }

  private parseClosure(async: boolean, move: boolean, isStatic: boolean, start: number): ast.Closure {
    const params: ast.ClosureParam[] = [];
    if (this.isOp("||")) {
      this.pos += 2;
    } else {
      this.expectChar("|");
      while (!this.isChar("|")) {
        const attrs = this.parseOuterAttrs();
        const pStart = this.tok.start;
        const pat = this.parsePatNoOr();
        let ty: ast.Type | null = null;
        if (this.eatChar(":")) ty = this.parseTypeNoBounds();
        params.push({ kind: "ClosureParam", attrs, pat, ty, start: pStart, end: this.prevEnd() });
        if (!this.eatChar(",")) break;
      }
      this.expectChar("|");
    }
    let ret: ast.Type | null = null;
    let body: ast.Expr;
    if (this.eatOp("->")) {
      ret = this.parseTypeNoBounds();
      const block = this.parseBlock();
      body = { kind: "BlockExpr", label: null, block, start: block.start, end: block.end };
    } else {
      const saved = this.noStruct;
      this.noStruct = false;
      body = this.parseExpr();
      this.noStruct = saved;
    }
    return { kind: "Closure", move, async, static: isStatic, params, ret, body, start, end: body.end };
  }

  private parseIf(): ast.If {
    const start = this.tok.start;
    this.expectKw("if");
    const cond = this.parseCond();
    const then = this.parseBlock();
    let els: ast.Expr | null = null;
    if (this.eatKw("else")) {
      if (this.isKw("if")) {
        els = this.parseIf();
      } else {
        const block = this.parseBlock();
        els = { kind: "BlockExpr", label: null, block, start: block.start, end: block.end };
      }
    }
    return { kind: "If", cond, then, else: els, start, end: this.prevEnd() };
  }

  private parseMatch(): ast.Match {
    const start = this.tok.start;
    this.expectKw("match");
    const expr = this.parseCond();
    this.expectOpen("{");
    const saved = this.noStruct;
    this.noStruct = false;
    // Inner attributes of the body live on the `Match` node, after any outer
    // attributes written before `match`.
    const inner = this.parseInnerAttrs();
    const arms: ast.MatchArm[] = [];
    while (!this.isClose("}")) {
      const attrs = this.parseOuterAttrs();
      const aStart = this.tok.start;
      const pat = this.parsePat();
      let guard: ast.Expr | null = null;
      if (this.eatKw("if")) guard = this.parseExpr();
      this.expectOp("=>");
      const { expr: body, blockLike } = this.parseStmtExpr();
      arms.push({ kind: "MatchArm", attrs, pat, guard, body, start: aStart, end: body.end });
      if (this.eatChar(",")) continue;
      if (!blockLike && !this.isClose("}")) this.error("expected `,` after match arm");
    }
    this.noStruct = saved;
    const close = this.expectClose("}");
    const match: ast.Match = { kind: "Match", expr, arms, start, end: close.end };
    if (inner.length > 0) match.attrs = inner;
    return match;
  }

  private parseLoop(label: string | null, start: number): ast.Loop {
    this.expectKw("loop");
    const body = this.parseBlock();
    return { kind: "Loop", label, body, start, end: body.end };
  }

  private parseWhile(label: string | null, start: number): ast.While {
    this.expectKw("while");
    const cond = this.parseCond();
    const body = this.parseBlock();
    return { kind: "While", label, cond, body, start, end: body.end };
  }

  private parseFor(label: string | null, start: number): ast.ForLoop {
    this.expectKw("for");
    const pat = this.parsePat();
    this.expectKw("in");
    const expr = this.parseCond();
    const body = this.parseBlock();
    return { kind: "ForLoop", label, pat, expr, body, start, end: body.end };
  }

  // -- macro invocations ----------------------------------------------------

  /** Cursor at the `!` after a path. */
  parseMacroAfterPath(path: ast.Path, attrs: ast.Attribute[]): ast.Macro {
    this.expectChar("!");
    const { delim, tokens, end } = this.parseDelimited();
    const args = this.parseMacroArgs(tokens);
    const mac: ast.Macro = { kind: "Macro", path, delim, tokens, args, start: path.start, end };
    if (attrs.length > 0) mac.attrs = attrs;
    return mac;
  }

  /** Best-effort parse of macro input as comma-separated expressions. */
  private parseMacroArgs(tokens: TokenTree[]): (ast.Expr | null)[] {
    if (tokens.length === 0) return [];
    const chunks = splitTokenTrees(tokens);
    const out: (ast.Expr | null)[] = [];
    for (const chunk of chunks) {
      if (chunk.length === 0) {
        out.push(null);
        continue;
      }
      const flat = flattenTokenTrees(chunk, chunk[chunk.length - 1].end);
      const sub = this.subParser(flat);
      try {
        const expr = sub.parseExpr();
        out.push(sub.atEof() ? expr : null);
      } catch (e) {
        if (!(e instanceof RustParseError)) throw e;
        out.push(null);
      }
    }
    return out;
  }

  // -- attribute meta items -------------------------------------------------

  protected parseMetaItems(tokens: TokenTree[]): ast.Meta[] {
    const out: ast.Meta[] = [];
    for (const chunk of splitTokenTrees(tokens)) {
      if (chunk.length === 0) continue;
      // A path: `ident`, `ident::ident`, also keywords (`unsafe`, `crate`).
      let i = 0;
      const segs: string[] = [];
      const first = chunk[0];
      if (first.kind === "ident") {
        segs.push(first.text);
        i = 1;
        for (;;) {
          const a = chunk[i];
          const b = chunk[i + 1];
          const c = chunk[i + 2];
          if (!a || !b || !c) break;
          if (a.kind !== "punct" || a.text !== ":" || b.kind !== "punct" || b.text !== ":" || c.kind !== "ident") break;
          segs.push(c.text);
          i += 3;
        }
      }
      if (segs.length === 0) {
        out.push({ kind: "MetaTokens", tokens: chunk });
        continue;
      }
      const path = segs.join("::");
      if (i === chunk.length) {
        out.push({ kind: "MetaPath", path });
        continue;
      }
      const next = chunk[i];
      if (next.kind === "group" && i === chunk.length - 1) {
        out.push({ kind: "MetaList", path, items: this.parseMetaItems(next.trees) });
        continue;
      }
      if (next.kind === "punct" && next.text === "=" && i + 1 < chunk.length) {
        const valueTrees = chunk.slice(i + 1);
        const value = this.src.slice(valueTrees[0].start, valueTrees[valueTrees.length - 1].end);
        let expr: ast.Expr | null = null;
        const sub = this.subParser(flattenTokenTrees(valueTrees, valueTrees[valueTrees.length - 1].end));
        try {
          const e = sub.parseExpr();
          if (sub.atEof()) expr = e;
        } catch (err) {
          if (!(err instanceof RustParseError)) throw err;
          expr = null;
        }
        out.push({ kind: "MetaNameValue", path, value, expr });
        continue;
      }
      out.push({ kind: "MetaTokens", tokens: chunk });
    }
    return out;
  }

  // -- blocks and statements ------------------------------------------------

  parseBlock(): ast.Block {
    const open = this.expectOpen("{");
    const saved = this.noStruct;
    this.noStruct = false;
    const attrs = this.parseInnerAttrs();
    const stmts: ast.Stmt[] = [];
    while (!this.isClose("}")) {
      if (this.atEof()) this.error("expected `}`");
      stmts.push(this.parseStmt());
    }
    this.noStruct = saved;
    const close = this.expectClose("}");
    return { kind: "Block", attrs, stmts, start: open.start, end: close.end };
  }

  private parseStmt(): ast.Stmt {
    const attrs = this.parseOuterAttrs();
    const t = this.tok;
    const start = t.start;

    if (this.isChar(";")) {
      this.pos++;
      return { kind: "Empty", start, end: t.end };
    }

    if (this.isKw("let")) {
      this.pos++;
      const pat = this.parsePat();
      let ty: ast.Type | null = null;
      if (this.eatChar(":")) ty = this.parseType();
      let init: ast.Expr | null = null;
      let els: ast.Block | null = null;
      if (this.isOp("=")) {
        this.pos++;
        init = this.parseExpr();
        if (this.eatKw("else")) els = this.parseBlock();
      }
      const semi = this.tok;
      this.expectChar(";");
      return { kind: "Local", attrs, pat, ty, init, else: els, start, end: semi.end };
    }

    if (this.isItemStart()) {
      return this.parseItem(attrs);
    }

    const { expr, blockLike } = this.parseStmtExpr();
    if (blockLike) {
      const semi = this.eatChar(";");
      return { kind: "ExprStmt", attrs, expr, semi, start, end: this.prevEnd() };
    }
    if (this.eatChar(";")) {
      return { kind: "ExprStmt", attrs, expr, semi: true, start, end: this.prevEnd() };
    }
    if (!this.isClose("}")) this.error("expected `;`");
    return { kind: "ExprStmt", attrs, expr, semi: false, start, end: expr.end };
  }

  /**
   * An expression in statement position. A block-like expression (`if`,
   * `match`, `{ }`, `unsafe { }`, `loop`, ...) ends the statement unless it is
   * followed by `.` or `?`.
   */
  private parseStmtExpr(): { expr: ast.Expr; blockLike: boolean } {
    const t = this.tok;
    const startsPrefix =
      t.kind === "punct" && (t.text === "-" || t.text === "!" || t.text === "*" || t.text === "&" || t.text === ".");
    if (startsPrefix) return { expr: this.parseExpr(), blockLike: false };
    const primary = this.parsePrimary();
    const continued = this.isChar("?") || this.peekOp() === ".";
    if (isBlockLike(primary) && !continued) {
      return { expr: primary, blockLike: true };
    }
    const expr = this.parseBinaryRest(this.parsePostfix(primary), PREC_ASSIGN);
    return { expr, blockLike: false };
  }
}
