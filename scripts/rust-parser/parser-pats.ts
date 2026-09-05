// Patterns.

import type * as ast from "./ast.ts";
import { TypeParser } from "./parser-types.ts";

export abstract class PatParser extends TypeParser {
  /** A pattern, with top-level `|` alternatives. */
  parsePat(): ast.Pat {
    const start = this.tok.start;
    // A leading `|` is allowed (`match x { | A | B => ... }`).
    if (this.isChar("|")) this.pos++;
    const first = this.parsePatNoOr();
    if (!this.isChar("|") || this.isOp("||")) return first;
    const alts: ast.Pat[] = [first];
    while (this.isChar("|") && !this.isOp("||")) {
      this.pos++;
      alts.push(this.parsePatNoOr());
    }
    return { kind: "PatOr", alts, start, end: this.prevEnd() };
  }

  /** A pattern without top-level alternatives (closure parameters, `let`, ...). */
  parsePatNoOr(): ast.Pat {
    const t = this.tok;
    const start = t.start;

    if (t.kind === "punct") {
      switch (t.text) {
        case "&": {
          this.pos++;
          const mutable = this.eatKw("mut");
          const pat = this.parsePatNoOr();
          return { kind: "PatRef", mutable, pat, start, end: pat.end };
        }
        case ".": {
          const op = this.peekOp();
          if (op === "..=" || op === "...") {
            this.pos += 3;
            const hi = this.parseRangeEnd();
            return { kind: "PatRange", lo: null, hi, inclusive: true, start, end: hi.end };
          }
          if (op === "..") {
            this.pos += 2;
            if (this.canStartRangeEnd()) {
              const hi = this.parseRangeEnd();
              return { kind: "PatRange", lo: null, hi, inclusive: false, start, end: hi.end };
            }
            return { kind: "PatRest", start, end: this.prevEnd() };
          }
          break;
        }
        case "-": {
          const lit = this.parseNegativeLit();
          return this.finishLitOrRange(lit, start);
        }
        case "<":
        case ":":
          return this.parsePatPathTail(this.parsePath("expr"), start);
      }
      this.error("expected pattern");
    }

    if (t.kind === "literal") {
      const lit = this.parseLit();
      return this.finishLitOrRange(lit, start);
    }

    if (t.kind === "open") {
      if (t.text === "(") {
        this.pos++;
        const saved = this.noStruct;
        this.noStruct = false;
        const elems: ast.Pat[] = [];
        let trailingComma = false;
        while (!this.isClose(")")) {
          elems.push(this.parsePat());
          trailingComma = false;
          if (!this.eatChar(",")) break;
          trailingComma = true;
        }
        this.noStruct = saved;
        const close = this.expectClose(")");
        if (elems.length === 1 && !trailingComma && elems[0].kind !== "PatRest") {
          return { kind: "PatParen", pat: elems[0], start, end: close.end };
        }
        return { kind: "PatTuple", elems, start, end: close.end };
      }
      if (t.text === "[") {
        this.pos++;
        const saved = this.noStruct;
        this.noStruct = false;
        const elems: ast.Pat[] = [];
        while (!this.isClose("]")) {
          elems.push(this.parsePat());
          if (!this.eatChar(",")) break;
        }
        this.noStruct = saved;
        const close = this.expectClose("]");
        return { kind: "PatSlice", elems, start, end: close.end };
      }
      this.error("expected pattern");
    }

    if (t.kind === "ident") {
      switch (t.text) {
        case "_":
          this.pos++;
          return { kind: "PatWild", start, end: t.end };
        case "true":
        case "false": {
          const lit = this.parseLit();
          return { kind: "PatLit", expr: lit, start, end: lit.end };
        }
        case "ref":
        case "mut": {
          const byRef = this.eatKw("ref");
          const mutable = this.eatKw("mut");
          const name = this.expectIdent();
          let sub: ast.Pat | null = null;
          if (this.isChar("@")) {
            this.pos++;
            sub = this.parsePatNoOr();
          }
          return { kind: "PatIdent", byRef, mutable, name, sub, start, end: this.prevEnd() };
        }
        case "box": {
          this.pos++;
          const pat = this.parsePatNoOr();
          return { kind: "PatBox", pat, start, end: pat.end };
        }
        case "const":
          if (this.isOpen("{", 1)) {
            this.pos++;
            const block = this.parseBlock();
            return { kind: "PatConst", block, start, end: block.end };
          }
          break;
      }
      if (this.isPathStartIdent()) {
        return this.parsePatPathTail(this.parsePath("expr"), start);
      }
    }

    return this.error("expected pattern");
  }

  private parsePatPathTail(path: ast.Path, start: number): ast.Pat {
    if (this.isChar("!") && this.peek(1).kind === "open") {
      return this.parseMacroAfterPath(path, []);
    }
    if (this.isOpen("(")) {
      this.pos++;
      const saved = this.noStruct;
      this.noStruct = false;
      const elems: ast.Pat[] = [];
      while (!this.isClose(")")) {
        elems.push(this.parsePat());
        if (!this.eatChar(",")) break;
      }
      this.noStruct = saved;
      const close = this.expectClose(")");
      return { kind: "PatTupleStruct", path, elems, start, end: close.end };
    }
    if (this.isOpen("{")) {
      return this.parsePatStruct(path, start);
    }
    const op = this.peekOp();
    if (op === "..=" || op === "..." || op === "..") {
      const lo: ast.PathExpr = { kind: "PathExpr", path, start: path.start, end: path.end };
      return this.finishRange(lo, start);
    }
    // A lone identifier is a binding, possibly with `@ sub`.
    const seg = path.segments[0];
    if (path.segments.length === 1 && !path.global && path.qself === null && seg.args === null && this.isIdent(-1)) {
      let sub: ast.Pat | null = null;
      if (this.isChar("@")) {
        this.pos++;
        sub = this.parsePatNoOr();
      }
      return { kind: "PatIdent", byRef: false, mutable: false, name: seg.name, sub, start, end: this.prevEnd() };
    }
    return { kind: "PatPath", path, start, end: path.end };
  }

  private parsePatStruct(path: ast.Path, start: number): ast.PatStruct {
    this.expectOpen("{");
    const saved = this.noStruct;
    this.noStruct = false;
    const fields: ast.FieldPat[] = [];
    let rest = false;
    while (!this.isClose("}")) {
      const attrs = this.parseOuterAttrs();
      const fStart = this.tok.start;
      if (this.isOp("..")) {
        this.pos += 2;
        rest = true;
        this.eatChar(",");
        break;
      }
      if (this.isKw("ref") || this.isKw("mut") || this.isKw("box")) {
        // Shorthand with binding mode: `ref x`, `mut x`, `ref mut x`.
        const pat = this.parsePatNoOr();
        const name =
          pat.kind === "PatIdent" ? pat.name : pat.kind === "PatBox" && pat.pat.kind === "PatIdent" ? pat.pat.name : "";
        fields.push({ kind: "FieldPat", attrs, member: name, pat, shorthand: true, start: fStart, end: pat.end });
      } else {
        const m = this.tok;
        if (m.kind !== "ident" && !(m.kind === "literal" && m.lit === "int")) this.error("expected field pattern");
        this.pos++;
        if (this.isChar(":") && !this.isOp("::")) {
          this.pos++;
          const pat = this.parsePat();
          fields.push({ kind: "FieldPat", attrs, member: m.text, pat, shorthand: false, start: fStart, end: pat.end });
        } else {
          const pat: ast.PatIdent = {
            kind: "PatIdent",
            byRef: false,
            mutable: false,
            name: m.text,
            sub: null,
            start: m.start,
            end: m.end,
          };
          fields.push({ kind: "FieldPat", attrs, member: m.text, pat, shorthand: true, start: fStart, end: m.end });
        }
      }
      if (!this.eatChar(",")) break;
    }
    this.noStruct = saved;
    const close = this.expectClose("}");
    return { kind: "PatStruct", path, fields, rest, start, end: close.end };
  }

  private parseNegativeLit(): ast.Expr {
    const start = this.tok.start;
    this.expectChar("-");
    const lit = this.parseLit();
    return { kind: "Unary", op: "-", expr: lit, start, end: lit.end };
  }

  private finishLitOrRange(lit: ast.Expr, start: number): ast.Pat {
    const op = this.peekOp();
    if (op === "..=" || op === "..." || op === "..") return this.finishRange(lit, start);
    return { kind: "PatLit", expr: lit, start, end: lit.end };
  }

  private finishRange(lo: ast.Expr, start: number): ast.PatRange {
    const op = this.peekOp()!;
    this.pos += op.length;
    const inclusive = op !== "..";
    let hi: ast.Expr | null = null;
    if (inclusive || this.canStartRangeEnd()) hi = this.parseRangeEnd();
    return { kind: "PatRange", lo, hi, inclusive, start, end: this.prevEnd() };
  }

  private canStartRangeEnd(): boolean {
    const t = this.tok;
    if (t.kind === "literal") return true;
    if (t.kind === "punct") return t.text === "-" || t.text === "<" || this.isOp("::");
    return this.isPathStartIdent();
  }

  /** A range pattern bound: literal, `-literal`, or a path. */
  private parseRangeEnd(): ast.Expr {
    const t = this.tok;
    if (t.kind === "literal") return this.parseLit();
    if (t.kind === "punct" && t.text === "-") return this.parseNegativeLit();
    const path = this.parsePath("expr");
    return { kind: "PathExpr", path, start: path.start, end: path.end };
  }
}
