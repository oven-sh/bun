// The grammar of commit f1982cf599 (productions of typescript-go) on top of model.mjs: "base" runs it with the old sink and
// without the hooks of this change, "new" with the new sink and the hooks.
import ts from "/workspace/bun/node_modules/typescript/lib/typescript.js";
import { P, tagOf, Sinks } from "./model.mjs";
const K = ts.SyntaxKind;
const KIND = { any: "Any", keyof: "PrefixKeyof", never: "Never", infer: "Infer", unique: "Unique", object: "Object", number: "Number", bigint: "Bigint", string: "String", symbol: "Symbol", unknown: "Unknown", boolean: "Boolean", asserts: "Asserts", abstract: "Abstract", readonly: "PrefixReadonly", undefined: "Undefined" };
const PRIM = { Any: "MAny", Never: "MNever", Unknown: "MUnknown", Undefined: "MUndefined", Object: "MObject", Number: "MNumber", String: "MString", Boolean: "MBoolean", Bigint: "MBigint", Symbol: "MSymbol" };
const { Discard, Old, New } = Sinks;
class Reject extends Error {}

export class P2 extends P {
  constructor(text, hooks) { super(text, hooks); this.hooks = hooks; this.sink = hooks ? New : Old; }
  kind() { return this.isIdent() && Object.hasOwn(KIND, this.word) ? KIND[this.word] : "Normal"; }
  lookAhead(cb) { const m = this.save(); let r = false; try { r = cb(); } catch (e) { if (!(e instanceof Error)) throw e; } this.restore(m); return r; }
  isStartOfFn() { return this.tok === K.LessThanToken || this.isKw("new") || (this.ctx("abstract") && this.lookAhead(() => { this.next(); return this.isKw("new"); })); }
  isStartOfType() {
    if (this.isIdent()) return true;
    if (["void", "null", "this", "typeof", "new", "true", "false", "import", "function"].some(w => this.isKw(w))) return true;
    if ([K.OpenBraceToken, K.OpenBracketToken, K.LessThanToken, K.BarToken, K.AmpersandToken, K.StringLiteral, K.NumericLiteral, K.BigIntLiteral, K.AsteriskToken, K.QuestionToken, K.ExclamationToken, K.DotDotDotToken, K.NoSubstitutionTemplateLiteral, K.TemplateHead].includes(this.tok)) return true;
    if (this.tok === K.MinusToken) return this.lookAhead(() => { this.next(); return this.tok === K.NumericLiteral || this.tok === K.BigIntLiteral; });
    if (this.tok === K.OpenParenToken) return true;
    return false;
  }
  parseType(S, opts, out) {
    if (this.isStartOfFn()) { this.fnOrCtor(S, opts, out); this.rest(S, false, opts, out); this.rest(S, true, opts, out); }
    else this.unionOrIntersection(S, true, opts, out);
    if (this.isKw("extends") && !this.nl && !opts.disallow) this.conditionalRest(S, out);
  }
  conditionalRest(S, out) {
    this.next();
    this.parseType(S, { disallow: true }, S.fresh());
    this.expect(K.QuestionToken);
    const whenTrue = this.hooks ? S.branch() : S.fresh();
    this.parseType(S, {}, whenTrue);
    this.expect(K.ColonToken);
    const r = S.conditionalTrue(out, whenTrue);
    if (r.decided) this.parseType(Discard, {}, {});
    else { this.parseType(S, {}, out); S.conditionalFalse(out, r.open); }
  }
  unionOrIntersection(S, isUnion, opts, out) {
    if (this.tok === (isUnion ? K.BarToken : K.AmpersandToken)) { this.next(); this.fnOrCtorToError(S, isUnion, opts, out); }
    else this.constituent(S, isUnion, opts, out);
    this.rest(S, isUnion, opts, out);
  }
  rest(S, isUnion, opts, out) {
    while (this.tok === (isUnion ? K.BarToken : K.AmpersandToken)) {
      this.next();
      const r = isUnion ? S.unionLeft(out) : S.intersectionLeft(out);
      if (r.decided) this.fnOrCtorToError(Discard, isUnion, opts, {});
      else { this.fnOrCtorToError(S, isUnion, opts, out); if (isUnion) S.unionRight(out, r.open); else S.intersectionRight(out, r.open); }
    }
  }
  constituent(S, isUnion, opts, out) { if (isUnion) this.unionOrIntersection(S, false, opts, out); else this.typeOperatorOrHigher(S, opts, out); }
  fnOrCtorToError(S, isUnion, opts, out) {
    if (this.isStartOfFn()) { this.fnOrCtor(S, opts, out); if (isUnion) this.rest(S, false, opts, out); return; }
    this.constituent(S, isUnion, opts, out);
  }
  typeOperatorOrHigher(S, opts, out) {
    if (this.tok === K.BarToken || this.tok === K.AmpersandToken) {
      while (this.tok === K.BarToken || this.tok === K.AmpersandToken) this.next();
      if (this.isStartOfFn()) this.fnOrCtor(S, opts, out); else this.typeOperatorOrHigher(S, opts, out);
      return;
    }
    const kind = this.kind();
    if (kind === "PrefixKeyof" || kind === "PrefixReadonly" || kind === "Unique") return this.typeOperator(S, kind, opts, out);
    if (kind === "Infer") return this.inferType(S, opts, out);
    this.nonArrayType(S, kind, opts, out);
    this.postfixRest(S, out);
  }
  typeOperator(S, operator, opts, out) {
    if (operator === "Unique") {
      this.next();
      if (this.ctx("symbol")) { this.next(); this.postfixRest(Discard, {}); if (this.hooks) S.uniqueType(out); return; }
      if (this.hooks && this.tok === K.OpenBracketToken && !this.nl) { this.typeOperatorOrHigher(Discard, {}, {}); S.uniqueType(out); return; }
      if (!this.predicateAfterName(S, out)) this.typeArgsOfRef();
      return this.postfixRest(S, out);
    }
    this.next();
    if (this.isStartOfFn()) this.fnOrCtor(Discard, {}, {}); else this.typeOperatorOrHigher(Discard, {}, {});
    if (opts.disallow && this.isKw("extends") && !this.nl) this.conditionalRest(Discard, {});
    if (operator === "PrefixKeyof") S.keyofType(out); else S.readonlyType(out);
  }
  inferType(S, opts, out) {
    this.next();
    if (!this.isIdent()) this.fail("infer name");
    this.next();
    if (this.isKw("extends")) {
      const mark = this.save();
      try {
        this.next();
        if (this.isStartOfFn()) this.fnOrCtor(Discard, { disallow: true }, {}); else this.typeOperatorOrHigher(Discard, { disallow: true }, {});
        if (!opts.disallow && this.tok === K.QuestionToken) throw new Reject("backtrack");
        this.rest(Discard, false, { ...opts, disallow: true }, {});
        this.rest(Discard, true, { ...opts, disallow: true }, {});
        if (!opts.disallow && this.tok === K.QuestionToken && this.lookAhead(() => { this.next(); return this.isStartOfType(); })) throw new Reject("backtrack");
      } catch (e) { if (!(e instanceof Error)) throw e; this.restore(mark); }
    }
    this.postfixRest(S, out);
  }
  postfixRest(S, out) {
    for (;;) {
      if (this.tok === K.ExclamationToken) { if (this.nl) return; this.next(); }
      else if (this.tok === K.OpenBracketToken) {
        if (this.nl) return;
        this.next();
        const hasIndex = this.tok !== K.CloseBracketToken;
        if (hasIndex) this.parseType(Discard, {}, {});
        this.expect(K.CloseBracketToken);
        S.indexOrArray(out, hasIndex);
      } else if (this.tok === K.DotToken) { this.next(); this.rightSideOfDot(S, out); this.typeArgsOfRef(); }
      else return;
    }
  }
  nonArrayType(S, kind, opts, out) {
    const t = this.tok;
    if (this.isIdent()) {
      if (Object.hasOwn(PRIM, kind)) return this.keywordTypeNode(S, kind, out);
      if (kind === "Asserts") return this.assertsTypePredicate(S, opts, out);
      return this.typeReference(S, kind, opts, out);
    }
    if (t === K.NumericLiteral) { this.next(); return S.literal(out, "MNumber"); }
    if (t === K.BigIntLiteral) { this.next(); return S.literal(out, "MBigint"); }
    if (t === K.StringLiteral || t === K.NoSubstitutionTemplateLiteral) { this.next(); return S.literal(out, "MString"); }
    if (this.isKw("true") || this.isKw("false")) { this.next(); return S.literal(out, "MBoolean"); }
    if (this.isKw("null")) { this.next(); return S.keyword(out, "MNull"); }
    if (this.isKw("void")) { this.next(); return S.keyword(out, "MVoid"); }
    if (t === K.MinusToken) { this.next(); if (this.tok === K.BigIntLiteral) { this.next(); return S.literal(out, "MBigint"); } this.expect(K.NumericLiteral); return S.literal(out, "MNumber"); }
    if (this.isKw("this")) { this.next(); if (!this.predicateAfterName(S, out)) S.keyword(out, "MObject"); return; }
    if (this.isKw("typeof")) return this.typeQuery(S, opts, out);
    if (t === K.OpenBraceToken) { this.balanced(K.OpenBraceToken, K.CloseBraceToken); return S.objectType(out); }
    if (t === K.OpenBracketToken) { S.tupleType(out); return this.balanced(K.OpenBracketToken, K.CloseBracketToken); }
    if (t === K.OpenParenToken) return this.parenOrFn2(S, out);
    if (this.isKw("import")) return this.importType(S, opts, out);
    if (t === K.TemplateHead) return this.template2(S, out);
    return this.typeReference(S, kind, opts, out);
  }
  template2(S, out) {
    for (;;) {
      this.next();
      this.parseType(Discard, {}, {});
      if (this.tok !== K.CloseBraceToken) this.fail("template");
      this.tok = this.s.reScanTemplateToken(false);
      if (this.tok === K.TemplateTail) { this.next(); break; }
    }
    S.templateType(out);
  }
  keywordTypeNode(S, kind, out) {
    const name = this.word;
    this.next();
    S.keyword(out, PRIM[kind]);
    if (this.hooks && this.tok === K.DotToken) { if (kind === "Undefined") S.keyword(out, "MObject"); else S.reference(out, name); }
    this.predicateAfterName(S, out);
  }
  predicateAfterName(S, out) {
    if (!this.ctx("is") || this.nl) return false;
    this.next();
    this.parseType(Discard, {}, {});
    if (this.hooks) S.typePredicate(out, false);
    return true;
  }
  typeArgsOfRef() { if (!this.nl) this.typeArgs2(); }
  typeArgs2() {
    if (this.tok !== K.LessThanToken) return false;
    this.next();
    for (;;) { this.parseType(Discard, {}, {}); if (this.tok !== K.CommaToken) break; this.next(); }
    this.expect(K.GreaterThanToken);
    return true;
  }
  assertsTypePredicate(S, opts, out) {
    let isAsserts = false;
    this.next();
    if (opts.isReturn && !this.nl && (this.isIdent() || this.isKw("this"))) {
      this.next();
      if (this.hooks) { isAsserts = true; S.typePredicate(out, true); }
      if (this.nl && this.ctx("is")) {
        const mark = this.save();
        this.next();
        if (this.startOfPredicateType()) { this.parseType(Discard, {}, {}); return; }
        this.restore(mark);
      }
    }
    if (this.predicateAfterName(S, out)) { if (isAsserts) S.typePredicate(out, true); }
    else this.typeArgsOfRef();
  }
  typeReference(S, kind, opts, out) {
    if (this.isIdent()) {
      if (kind === "Normal") S.reference(out, this.word);
      this.next();
      if (this.predicateAfterName(S, out)) return;
    } else if (this.isKw("const")) { this.next(); return; }
    else if (this.isWord() && !(this.isKw("extends") && !this.nl && this.lookAhead(() => { this.next(); return this.isStartOfType(); })) && !(this.isKw("in") && opts.isIndexSignature)) this.next();
    else this.fail("type expected");
    while (this.tok === K.DotToken) { this.next(); if (this.tok === K.LessThanToken) break; this.rightSideOfDot(S, out); }
    this.typeArgsOfRef();
  }
  rightSideOfDot(S, out) { if (!this.isWord()) this.fail("member"); S.member(out, this.word, true); this.next(); }
  importType(S, opts, out) {
    this.next();
    if (this.hooks) S.importType(out);
    this.expect(K.OpenParenToken); this.expect(K.StringLiteral);
    if (this.tok === K.CommaToken) { this.next(); this.balanced(K.OpenBraceToken, K.CloseBraceToken); if (this.tok === K.CommaToken) this.next(); }
    this.expect(K.CloseParenToken);
    if (this.tok === K.DotToken) { this.next(); this.rightSideOfDot(S, out); while (this.tok === K.DotToken) { this.next(); if (this.tok === K.LessThanToken) break; this.rightSideOfDot(S, out); } }
    this.typeArgsOfRef();
  }
  typeQuery(S, opts, out) {
    this.next();
    S.typeofQuery(out);
    if (this.isKw("import")) return this.importType(S, opts, out);
    if (!this.isWord()) this.fail("typeof operand");
    this.next();
    while (this.tok === K.DotToken) { this.next(); if (!this.isWord() && this.tok !== K.PrivateIdentifier) this.fail("typeof member"); this.next(); }
    this.typeArgsOfRef();
  }
  fnOrCtor(S, opts, out) {
    if (this.isIdent()) this.next();
    if (this.isKw("new")) this.next();
    this.typeParams();
    this.parenOrFn2(S, out);
    this.postfixRest(S, out);
  }
  returnType2() {
    if (this.isIdent() && /^[ \t]*is[ \t]/.test(this.text.slice(this.s.getTokenEnd())) && this.predicateOfKeywordName()) return;
    this.parseType(Discard, { isReturn: true }, {});
  }
  predicateOfKeywordName() {
    const kind = this.kind();
    if (!["PrefixKeyof", "PrefixReadonly", "Infer", "Asserts"].includes(kind)) return false;
    const mark = this.save();
    this.next();
    let ok = this.ctx("is") && !this.nl;
    if (ok) { this.next(); ok = this.startOfPredicateType() && !(kind === "Asserts" && this.ctx("is")); }
    this.restore(mark);
    if (!ok) return false;
    this.next(); this.next(); this.parseType(Discard, {}, {});
    return true;
  }
  parenOrFn2(S, out) {
    const mark = this.save();
    this.balanced(K.OpenParenToken, K.CloseParenToken);
    if (this.tok === K.EqualsGreaterThanToken) { this.next(); this.returnType2(); S.functionType(out); return; }
    this.restore(mark);
    this.expect(K.OpenParenToken);
    const inner = this.hooks ? S.nested(out) : S.fresh();
    this.parseType(S, {}, inner);
    S.parenthesized(out, inner);
    this.expect(K.CloseParenToken);
  }
}

export function tagOfForm2(form, isReturn, hooks) {
  const p = new P2(form + " ;", hooks);
  const S = p.sink;
  if (isReturn && p.isIdent() && /^[ \t]*is[ \t]/.test(p.text.slice(p.s.getTokenEnd())) && p.predicateOfKeywordName()) {
    if (p.tok !== K.SemicolonToken) p.fail("trailing");
    return "Boolean";
  }
  const out = S.fresh();
  p.parseType(S, isReturn ? { isReturn: true } : {}, out);
  if (p.tok !== K.SemicolonToken) p.fail("trailing");
  return tagOf(out);
}
