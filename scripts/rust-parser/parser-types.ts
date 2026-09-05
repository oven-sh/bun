// Types, generic parameters and arguments, bounds, where clauses.

import type * as ast from "./ast.ts";
import { ParserBase } from "./parser-base.ts";

export abstract class TypeParser extends ParserBase {
  /** A type, with `+` bounds allowed after `dyn`/`impl`. */
  parseType(): ast.Type {
    return this.parseTypeInner(true);
  }

  /** A type where a following `+` belongs to the enclosing context. */
  parseTypeNoBounds(): ast.Type {
    return this.parseTypeInner(false);
  }

  private parseTypeInner(allowPlus: boolean): ast.Type {
    const t = this.tok;
    const start = t.start;

    if (t.kind === "punct") {
      if (t.text === "&") {
        this.pos++;
        const lifetime = this.isLifetime() ? this.parseLifetime() : null;
        const mutable = this.eatKw("mut");
        const elem = this.parseTypeNoBounds();
        return { kind: "TypeRef", lifetime, mutable, elem, start, end: elem.end };
      }
      if (t.text === "*") {
        this.pos++;
        let mutable = false;
        if (this.eatKw("mut")) mutable = true;
        else this.expectKw("const");
        const elem = this.parseTypeNoBounds();
        return { kind: "TypePtr", mutable, elem, start, end: elem.end };
      }
      if (t.text === "!") {
        this.pos++;
        return { kind: "TypeNever", start, end: t.end };
      }
      if (t.text === "<" || t.text === ":") {
        return this.parseTypePathOrMacro();
      }
      if (t.text === "?" || t.text === "~") {
        // `?Sized` / `~const Trait` as a bare type only occurs in bound position.
        const bounds = this.parseBounds();
        return { kind: "TypeTraitObject", dyn: false, bounds, start, end: this.prevEnd() };
      }
      this.error("expected type");
    }

    if (t.kind === "open") {
      if (t.text === "[") {
        this.pos++;
        const saved = this.noStruct;
        this.noStruct = false;
        const elem = this.parseType();
        if (this.eatChar(";")) {
          const len = this.parseExpr();
          this.noStruct = saved;
          const close = this.expectClose("]");
          return { kind: "TypeArray", elem, len, start, end: close.end };
        }
        this.noStruct = saved;
        const close = this.expectClose("]");
        return { kind: "TypeSlice", elem, start, end: close.end };
      }
      if (t.text === "(") {
        this.pos++;
        const elems: ast.Type[] = [];
        let trailingComma = false;
        while (!this.isClose(")")) {
          elems.push(this.parseType());
          trailingComma = false;
          if (!this.eatChar(",")) break;
          trailingComma = true;
        }
        const close = this.expectClose(")");
        if (elems.length === 1 && !trailingComma) {
          return { kind: "TypeParen", elem: elems[0], start, end: close.end };
        }
        return { kind: "TypeTuple", elems, start, end: close.end };
      }
      this.error("expected type");
    }

    if (t.kind === "lifetime") {
      // A lifetime in type position: only valid as a bound (`dyn 'a + Trait`).
      const bounds = this.parseBounds();
      return { kind: "TypeTraitObject", dyn: false, bounds, start, end: this.prevEnd() };
    }

    if (t.kind === "ident") {
      switch (t.text) {
        case "_":
          this.pos++;
          return { kind: "TypeInfer", start, end: t.end };
        case "fn":
        case "unsafe":
        case "extern":
          return this.parseBareFn([]);
        case "for": {
          const forLifetimes = this.parseForLifetimes();
          if (this.isKw("fn") || this.isKw("unsafe") || this.isKw("extern"))
            return this.parseBareFn(forLifetimes, start);
          // `for<'a> Trait<'a>` used as a bare bound.
          const bound = this.parseTraitBound(forLifetimes, start);
          const bounds: ast.Bound[] = [bound];
          if (allowPlus) this.parseMoreBounds(bounds);
          return { kind: "TypeTraitObject", dyn: false, bounds, start, end: this.prevEnd() };
        }
        case "dyn": {
          // `dyn` is a contextual keyword before 2018, but in practice it is
          // always the trait-object marker here.
          this.pos++;
          const bounds = allowPlus ? this.parseBounds() : [this.parseBound()];
          return { kind: "TypeTraitObject", dyn: true, bounds, start, end: this.prevEnd() };
        }
        case "impl": {
          this.pos++;
          const bounds = allowPlus ? this.parseBounds() : [this.parseBound()];
          return { kind: "TypeImplTrait", bounds, start, end: this.prevEnd() };
        }
      }
      return this.parseTypePathOrMacro();
    }

    return this.error("expected type");
  }

  private parseTypePathOrMacro(): ast.Type {
    const start = this.tok.start;
    const path = this.parsePath("type");
    if (this.isChar("!") && this.peek(1).kind === "open") {
      return this.parseMacroAfterPath(path, []);
    }
    return { kind: "TypePath", path, start, end: path.end };
  }

  /** Implemented by the expression layer: a macro invocation, cursor at the `!`. */
  abstract parseMacroAfterPath(path: ast.Path, attrs: ast.Attribute[]): ast.Macro;

  /** `for<'a, 'b>` */
  parseForLifetimes(): ast.LifetimeParam[] {
    this.expectKw("for");
    this.expectChar("<");
    const out: ast.LifetimeParam[] = [];
    while (!this.isChar(">")) {
      const attrs = this.parseOuterAttrs();
      const lt = this.parseLifetime();
      const bounds: ast.Lifetime[] = [];
      if (this.eatChar(":")) {
        while (this.isLifetime()) {
          bounds.push(this.parseLifetime());
          if (!this.eatChar("+")) break;
        }
      }
      out.push({ kind: "LifetimeParam", attrs, name: lt.name, bounds, start: lt.start, end: this.prevEnd() });
      if (!this.eatChar(",")) break;
    }
    this.expectChar(">");
    return out;
  }

  /** `[for<'a>] [unsafe] [extern "C"] fn(params) -> ret` */
  private parseBareFn(forLifetimes: ast.LifetimeParam[], start = this.tok.start): ast.TypeBareFn {
    const unsafe = this.eatKw("unsafe");
    let abi: string | null = null;
    if (this.eatKw("extern")) {
      abi = "";
      if (this.tok.kind === "literal" && this.tok.lit === "str") abi = this.next().text.slice(1, -1);
    }
    this.expectKw("fn");
    this.expectOpen("(");
    const params: ast.BareFnParam[] = [];
    let variadic = false;
    while (!this.isClose(")")) {
      const attrs = this.parseOuterAttrs();
      const pStart = this.tok.start;
      if (this.isOp("...")) {
        this.pos += 3;
        variadic = true;
        break;
      }
      let name: string | null = null;
      if ((this.isIdent() || this.isUnderscore()) && this.isChar(":", 1) && !this.isOp("::", 1)) {
        name = this.next().text;
        this.pos++;
        if (this.isOp("...")) {
          this.pos += 3;
          variadic = true;
          break;
        }
      }
      const ty = this.parseType();
      params.push({ kind: "BareFnParam", attrs, name, ty, start: pStart, end: ty.end });
      if (!this.eatChar(",")) break;
    }
    this.expectClose(")");
    let ret: ast.Type | null = null;
    if (this.eatOp("->")) ret = this.parseTypeNoBounds();
    return { kind: "TypeBareFn", forLifetimes, unsafe, abi, params, variadic, ret, start, end: this.prevEnd() };
  }

  // -- generic arguments ----------------------------------------------------

  /** `<...>` at the cursor. */
  parseAngleArgs(turbofish: boolean): ast.AngleArgs {
    const start = turbofish ? this.tokens[this.pos - 2].start : this.tok.start;
    this.expectChar("<");
    const args: ast.GenericArg[] = [];
    const saved = this.noStruct;
    this.noStruct = false;
    while (!this.isChar(">")) {
      args.push(this.parseGenericArg());
      if (!this.eatChar(",")) break;
    }
    this.noStruct = saved;
    const close = this.tok;
    this.expectChar(">");
    return { kind: "AngleArgs", turbofish, args, start, end: close.end };
  }

  private parseGenericArg(): ast.GenericArg {
    const t = this.tok;
    const start = t.start;
    if (t.kind === "lifetime") return this.parseLifetime();
    if (t.kind === "literal" || (t.kind === "ident" && (t.text === "true" || t.text === "false"))) {
      const expr = this.parseLit();
      return { kind: "ConstArg", expr, start, end: expr.end };
    }
    if (t.kind === "punct" && t.text === "-") {
      this.pos++;
      const lit = this.parseLit();
      const expr: ast.Unary = { kind: "Unary", op: "-", expr: lit, start, end: lit.end };
      return { kind: "ConstArg", expr, start, end: lit.end };
    }
    if (t.kind === "open" && t.text === "{") {
      const block = this.parseBlock();
      const expr: ast.BlockExpr = { kind: "BlockExpr", label: null, block, start, end: block.end };
      return { kind: "ConstArg", expr, start, end: block.end };
    }
    const ty = this.parseType();
    // `Item = T`, `Item: Bound`, `Item<'a> = T`.
    if (ty.kind === "TypePath" && ty.path.segments.length === 1 && !ty.path.global && ty.path.qself === null) {
      const seg = ty.path.segments[0];
      const segArgs = seg.args && seg.args.kind === "AngleArgs" ? seg.args : null;
      if (seg.args === null || segArgs) {
        if (this.isOp("=")) {
          this.pos++;
          const v = this.tok;
          if (
            v.kind === "literal" ||
            (v.kind === "punct" && v.text === "-") ||
            (v.kind === "open" && v.text === "{") ||
            this.isKw("true") ||
            this.isKw("false")
          ) {
            const value = this.parseConstArgExpr();
            return { kind: "AssocBinding", name: seg.name, args: segArgs, ty: null, value, start, end: value.end };
          }
          const value = this.parseType();
          return { kind: "AssocBinding", name: seg.name, args: segArgs, ty: value, value: null, start, end: value.end };
        }
        if (this.isChar(":") && !this.isOp("::")) {
          this.pos++;
          const bounds = this.parseBounds();
          return { kind: "AssocConstraint", name: seg.name, args: segArgs, bounds, start, end: this.prevEnd() };
        }
      }
    }
    return ty;
  }

  // -- bounds ---------------------------------------------------------------

  /** `Bound + Bound + ...` */
  parseBounds(): ast.Bound[] {
    const bounds: ast.Bound[] = [];
    if (!this.canStartBound()) return bounds;
    bounds.push(this.parseBound());
    this.parseMoreBounds(bounds);
    return bounds;
  }

  private parseMoreBounds(bounds: ast.Bound[]): void {
    while (this.isChar("+")) {
      this.pos++;
      if (!this.canStartBound()) break;
      bounds.push(this.parseBound());
    }
  }

  private canStartBound(): boolean {
    const t = this.tok;
    if (t.kind === "lifetime") return true;
    if (t.kind === "punct") return t.text === "?" || t.text === "~" || t.text === "<" || t.text === ":";
    if (t.kind === "open") return t.text === "(" || t.text === "[";
    if (t.kind === "ident") {
      return (
        this.isPathStartIdent() || t.text === "for" || t.text === "const" || t.text === "async" || t.text === "use"
      );
    }
    return false;
  }

  parseBound(): ast.Bound {
    const t = this.tok;
    const start = t.start;
    if (t.kind === "lifetime") return this.parseLifetime();
    if (t.kind === "open" && t.text === "(") {
      this.pos++;
      const inner = this.parseBound();
      this.expectClose(")");
      return inner;
    }
    if (t.kind === "ident" && t.text === "use" && this.isChar("<", 1)) {
      this.pos += 2;
      const args: string[] = [];
      while (!this.isChar(">")) {
        args.push(this.next().text);
        if (!this.eatChar(",")) break;
      }
      const close = this.tok;
      this.expectChar(">");
      return { kind: "UseBound", args, start, end: close.end };
    }
    return this.parseTraitBound([], start);
  }

  private parseTraitBound(forLifetimes: ast.LifetimeParam[], start: number): ast.TraitBound {
    let maybe = false;
    let constness: ast.TraitBound["constness"] = null;
    let async = false;
    for (;;) {
      if (this.isChar("?")) {
        this.pos++;
        maybe = true;
      } else if (this.isChar("~") && this.isKw("const", 1)) {
        this.pos += 2;
        constness = "~const";
      } else if (this.isOpen("[") && this.isKw("const", 1) && this.isClose("]", 2)) {
        this.pos += 3;
        constness = "[const]";
      } else if (this.isKw("const") && !this.isOpen("{", 1)) {
        this.pos++;
        constness = "const";
      } else if (this.isKw("async")) {
        this.pos++;
        async = true;
      } else if (this.isKw("for") && forLifetimes.length === 0) {
        forLifetimes = this.parseForLifetimes();
      } else {
        break;
      }
    }
    const path = this.parsePath("type");
    return { kind: "TraitBound", maybe, constness, async, forLifetimes, path, start, end: path.end };
  }

  // -- generic parameters and where clauses ---------------------------------

  /** `<params>` if present. The where clause is filled in later by `parseWhere`. */
  parseGenerics(): ast.Generics {
    const start = this.tok.start;
    const params: ast.GenericParam[] = [];
    if (!this.isChar("<")) return { kind: "Generics", params, where: [], start, end: start };
    this.pos++;
    while (!this.isChar(">")) {
      const attrs = this.parseOuterAttrs();
      const t = this.tok;
      if (t.kind === "lifetime") {
        const lt = this.parseLifetime();
        const bounds: ast.Lifetime[] = [];
        if (this.eatChar(":")) {
          while (this.isLifetime()) {
            bounds.push(this.parseLifetime());
            if (!this.eatChar("+")) break;
          }
        }
        params.push({ kind: "LifetimeParam", attrs, name: lt.name, bounds, start: lt.start, end: this.prevEnd() });
      } else if (this.isKw("const")) {
        this.pos++;
        const name = this.expectIdent();
        this.expectChar(":");
        const ty = this.parseType();
        let def: ast.Expr | null = null;
        if (this.isOp("=")) {
          this.pos++;
          def = this.parseConstArgExpr();
        }
        params.push({ kind: "ConstParam", attrs, name, ty, default: def, start: t.start, end: this.prevEnd() });
      } else {
        const name = this.expectIdent();
        let bounds: ast.Bound[] = [];
        if (this.eatChar(":")) bounds = this.parseBounds();
        let def: ast.Type | null = null;
        if (this.isOp("=")) {
          this.pos++;
          def = this.parseType();
        }
        params.push({ kind: "TypeParam", attrs, name, bounds, default: def, start: t.start, end: this.prevEnd() });
      }
      if (!this.eatChar(",")) break;
    }
    const close = this.tok;
    this.expectChar(">");
    return { kind: "Generics", params, where: [], start, end: close.end };
  }

  /** A const generic default/argument: literal, `-literal`, or `{ block }`. */
  private parseConstArgExpr(): ast.Expr {
    const start = this.tok.start;
    if (this.isOpen("{")) {
      const block = this.parseBlock();
      return { kind: "BlockExpr", label: null, block, start, end: block.end };
    }
    if (this.isChar("-")) {
      this.pos++;
      const lit = this.parseLit();
      return { kind: "Unary", op: "-", expr: lit, start, end: lit.end };
    }
    if (this.isPathStartIdent() && !this.isKw("true") && !this.isKw("false")) {
      const path = this.parsePath("expr");
      return { kind: "PathExpr", path, start, end: path.end };
    }
    return this.parseLit();
  }

  /** `where ...` if present; the predicates are stored into `generics.where`. */
  parseWhere(generics: ast.Generics): void {
    if (!this.eatKw("where")) return;
    for (;;) {
      const t = this.tok;
      if (
        t.kind === "eof" ||
        t.kind === "close" ||
        (t.kind === "open" && t.text === "{") ||
        this.isChar(";") ||
        this.isOp("=")
      )
        break;
      const start = t.start;
      if (t.kind === "lifetime") {
        const lifetime = this.parseLifetime();
        this.expectChar(":");
        const bounds: ast.Lifetime[] = [];
        while (this.isLifetime()) {
          bounds.push(this.parseLifetime());
          if (!this.eatChar("+")) break;
        }
        generics.where.push({ kind: "WhereLifetime", lifetime, bounds, start, end: this.prevEnd() });
      } else {
        const forLifetimes = this.isKw("for") ? this.parseForLifetimes() : [];
        const ty = this.parseType();
        this.expectChar(":");
        const bounds = this.parseBounds();
        generics.where.push({ kind: "WhereType", forLifetimes, ty, bounds, start, end: this.prevEnd() });
      }
      if (!this.eatChar(",")) break;
    }
    generics.end = Math.max(generics.end, this.prevEnd());
  }
}
