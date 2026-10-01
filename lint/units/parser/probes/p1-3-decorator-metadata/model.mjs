// Model of Bun's type grammar and of its decorator metadata sink, before ("old") and after ("new") the change.
// The old mode must reproduce the "bun" column of metadata.table.tsv: that is the proof that the model follows the code.
import ts from "/workspace/bun/node_modules/typescript/lib/typescript.js";
const K = ts.SyntaxKind;
// Words that Bun's lexer reads as keywords; every other word is T::TIdentifier.
const BUN_KEYWORDS = new Set("break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with".split(" "));
const KIND = { any: "Any", keyof: "PrefixKeyof", never: "Never", infer: "Infer", unique: "Unique", object: "Object", number: "Number", bigint: "Bigint", string: "String", symbol: "Symbol", unknown: "Unknown", boolean: "Boolean", asserts: "Asserts", abstract: "Abstract", readonly: "PrefixReadonly", undefined: "Undefined" };
const PRIM = { Any: "MAny", Never: "MNever", Unknown: "MUnknown", Undefined: "MUndefined", Object: "MObject", Number: "MNumber", String: "MString", Boolean: "MBoolean", Bigint: "MBigint", Symbol: "MSymbol" };
const LV = { Lowest: 0, BitwiseOr: 9, BitwiseAnd: 11, Prefix: 18 };
class Reject extends Error {}
// dots: whether two dotted names are compared where operands merge (the new merge rule).
export const cfg = { dots: false };
const M = k => ({ k });
const disc = m => m.k;
const clone = m => ({ ...m, dot: m.dot && [...m.dot] });
const elidableU = m => m.k === "MNever" || m.k === "MUndefined" || m.k === "MNull";

function finishUnion(m) {
  if (m.k === "MIdentifier") return m.name === "Object" ? M("MObject") : null;
  if (m.k === "MUnknown" || m.k === "MAny" || m.k === "MObject") return M("MObject");
  if (elidableU(m)) { m.k = "MNone"; return null; }
  return null;
}
function mergeUnion(result, left) {
  if (left.k !== "MNone") {
    if (disc(result) !== disc(left)) {
      const v = elidableU(result) ? left : M("MObject");
      Object.keys(result).forEach(key => delete result[key]); Object.assign(result, clone(v));
    } else if (result.k === "MIdentifier" && result.name !== left.name) { delete result.name; result.k = "MObject"; }
    else if (cfg.dots && result.k === "MDot" && result.dot.join(".") !== left.dot.join(".")) { delete result.dot; result.k = "MObject"; }
  }
}
function finishIntersection(m) {
  if (m.k === "MIdentifier") return m.name === "Object" ? M("MObject") : null;
  if (m.k === "MNever") return M("MNever");
  if (m.k === "MAny" || m.k === "MObject") return M("MObject");
  if (m.k === "MUnknown" || m.k === "MNull" || m.k === "MUndefined") { m.k = "MNone"; return null; }
  return null;
}
function mergeIntersection(result, left) {
  if (left.k !== "MNone") {
    if (disc(result) !== disc(left)) {
      const v = (result.k === "MUnknown" || result.k === "MUndefined" || result.k === "MNull") ? left : result.k === "MNever" ? M("MNever") : M("MObject");
      Object.keys(result).forEach(key => delete result[key]); Object.assign(result, clone(v));
    } else if (result.k === "MIdentifier" && result.name !== left.name) { delete result.name; result.k = "MObject"; }
    else if (cfg.dots && result.k === "MDot" && result.dot.join(".") !== left.dot.join(".")) { delete result.dot; result.k = "MObject"; }
  } else if (result.k === "MUnknown") result.k = "MUndefined";
}
const set = (out, v) => { const keep = { shape: out.shape, inBranch: out.inBranch }; Object.keys(out).forEach(key => delete out[key]); Object.assign(out, clone(v), keep); };

// ---- sinks. `out` is a Metadata value in the old sink and a Tag (value, shape, inBranch) in the new one.
const Discard = { discard: true, fresh: () => ({}), nested: () => ({}), branch: () => ({}) };
for (const h of ["literal", "keyword", "functionType", "parenthesized", "keyofType", "readonlyType", "typeofQuery", "tupleType", "objectType", "templateType", "reference", "member", "indexOrArray", "unionRight", "intersectionRight", "conditionalFalse", "importType", "uniqueType", "typePredicate"]) Discard[h] = () => {};
Discard.unionLeft = Discard.intersectionLeft = Discard.conditionalTrue = () => ({ open: {} });

const Old = {
  fresh: () => M("MNone"), nested: () => M("MNone"), branch: () => M("MNone"),
  literal: (out, m) => set(out, M(m)), keyword: (out, m) => set(out, M(m)),
  functionType: out => set(out, M("MFunction")), parenthesized: (out, inner) => set(out, inner),
  keyofType: out => set(out, M("MObject")), readonlyType: out => set(out, M("MArray")), typeofQuery: out => set(out, M("MObject")),
  tupleType: out => set(out, M("MArray")), objectType: out => set(out, M("MObject")), templateType: out => set(out, M("MString")),
  reference: (out, name) => set(out, { k: "MIdentifier", name }),
  member(out, name, isName) {
    if (out.k === "MIdentifier") set(out, { k: "MDot", dot: [out.name, name] });
    else if (out.k === "MDot") { if (isName) out.dot.push(name); }
  },
  indexOrArray(out, hasIndex) { set(out, M(out.k === "MNone" ? "MArray" : hasIndex ? "MObject" : "MArray")); },
  unionLeft(out) { const left = clone(out); const done = finishUnion(left); if (done) { set(out, done); return { decided: true }; } return { open: left }; },
  unionRight: (out, left) => mergeUnion(out, left),
  intersectionLeft(out) { const left = clone(out); const done = finishIntersection(left); if (done) { set(out, done); return { decided: true }; } return { open: left }; },
  intersectionRight: (out, left) => mergeIntersection(out, left),
  conditionalTrue(out, whenTrue) { const left = whenTrue; const done = finishIntersection(left); if (done) { set(out, done); return { decided: true }; } return { open: left }; },
  conditionalFalse: (out, left) => mergeIntersection(out, left),
  importType() {}, uniqueType() {}, typePredicate() {},
};

// The new sink. shape: 0 a type that is no union and no intersection, 1 a union read so far, 2 an intersection read so far.
const seal = t => { if (t.k === "MNever" || t.k === "MNull" || t.k === "MUndefined") t.k = "MVoid"; else if (t.k === "MAny" || t.k === "MUnknown") t.k = "MObject"; t.shape = 0; };
const settle = t => { if (t.shape !== 0) seal(t); if (t.inBranch && (t.k === "MIdentifier" || t.k === "MDot")) { delete t.name; delete t.dot; t.k = "MObject"; } };
const leaf = (out, v) => { set(out, v); out.shape = 0; };
const New = {
  fresh: () => ({ k: "MNone", shape: 0, inBranch: false }),
  nested: out => ({ k: "MNone", shape: 0, inBranch: out.inBranch }),
  branch: () => ({ k: "MNone", shape: 0, inBranch: true }),
  literal: (out, m) => leaf(out, M(m)), keyword: (out, m) => leaf(out, M(m)),
  functionType: out => leaf(out, M("MFunction")),
  parenthesized(out, inner) { if (inner.shape !== 0) seal(inner); leaf(out, { k: inner.k, name: inner.name, dot: inner.dot }); },
  keyofType: out => leaf(out, M("MObject")), readonlyType: out => leaf(out, M("MArray")), typeofQuery: out => leaf(out, M("MObject")),
  tupleType: out => leaf(out, M("MArray")), objectType: out => leaf(out, M("MObject")), templateType: out => leaf(out, M("MString")),
  importType: out => leaf(out, M("MObject")), uniqueType: out => leaf(out, M("MObject")),
  typePredicate: (out, asserts) => leaf(out, M(asserts ? "MVoid" : "MBoolean")),
  reference: (out, name) => leaf(out, { k: "MIdentifier", name }),
  member(out, name, isName) {
    if (out.k === "MIdentifier") set(out, { k: "MDot", dot: [out.name, name] });
    else if (out.k === "MDot") { if (isName) out.dot.push(name); }
  },
  indexOrArray(out, hasIndex) { leaf(out, M(out.k === "MNone" ? "MArray" : hasIndex ? "MObject" : "MArray")); },
  unionLeft(out) {
    if (out.shape === 2) seal(out);
    settle2(out);
    const left = clone(out); const done = finishUnion(left);
    if (done) { set(out, done); out.shape = 1; return { decided: true }; }
    return { open: left };
  },
  unionRight(out, left) { if (out.shape === 2) seal(out); settle2(out); mergeUnion(out, left); out.shape = 1; },
  intersectionLeft(out) {
    settle2(out);
    const left = clone(out); const done = finishIntersection(left);
    if (done) { set(out, done); out.shape = 2; return { decided: true }; }
    return { open: left };
  },
  intersectionRight(out, left) { settle2(out); mergeIntersection(out, left); out.shape = 2; },
  conditionalTrue(out, whenTrue) {
    const left = whenTrue; settle(left);
    const done = finishUnion(left);
    if (done) { set(out, done); out.shape = 0; return { decided: true }; }
    left.inBranch = out.inBranch;
    Object.keys(out).forEach(key => delete out[key]); Object.assign(out, New.branch());
    return { open: left };
  },
  conditionalFalse(out, left) { settle(out); mergeUnion(out, left); seal(out); out.inBranch = left.inBranch; },
};
// In a branch of a conditional type a reference is Object.
function settle2(t) { if (t.inBranch && (t.k === "MIdentifier" || t.k === "MDot")) { delete t.name; delete t.dot; t.k = "MObject"; } }

export const Sinks = { Discard, Old, New };
export class P {
  constructor(text, isNew) {
    this.text = text; this.isNew = isNew; this.sink = isNew ? New : Old;
    this.s = ts.createScanner(ts.ScriptTarget.ESNext, /*skipTrivia*/ true, ts.LanguageVariant.Standard, text);
    this.next();
  }
  next() { this.tok = this.s.scan(); this.nl = this.s.hasPrecedingLineBreak(); this.word = this.isWord() ? this.s.getTokenValue() : ""; }
  isWord() { return this.tok === K.Identifier || (this.tok >= K.FirstKeyword && this.tok <= K.LastKeyword); }
  isIdent() { return this.isWord() && !BUN_KEYWORDS.has(this.word); }
  isKw(w) { return this.isWord() && this.word === w && BUN_KEYWORDS.has(w); }
  ctx(w) { return this.isIdent() && this.word === w; }
  fail(why) { throw new Reject(why + " at " + this.s.getTokenStart() + " in " + this.text); }
  expect(kind) { if (this.tok !== kind) this.fail("expected " + K[kind]); this.next(); }
  save() { return { pos: this.s.getTokenFullStart(), tok: this.tok, nl: this.nl, word: this.word }; }
  restore(m) { this.s.resetTokenState(m.pos); this.next(); }
  // Skips from the opening token to after its closing token.
  balanced(open, close) {
    let depth = 0;
    for (;;) {
      if (this.tok === K.EndOfFileToken) this.fail("unbalanced");
      if (this.tok === K.TemplateHead) { this.template(Discard, {}); continue; }
      if (this.tok === open) depth++;
      else if (this.tok === close) { depth--; if (depth === 0) { this.next(); return; } }
      this.next();
    }
  }
  template(S, out) {
    for (;;) {
      this.next();
      this.type(Discard, LV.Lowest, {}, {});
      if (this.tok !== K.CloseBraceToken) this.fail("template");
      this.tok = this.s.reScanTemplateToken(false);
      if (this.tok === K.TemplateTail) { this.next(); break; }
    }
    S.templateType(out);
  }
  typeArgs() {
    if (this.tok !== K.LessThanToken) return false;
    this.next();
    for (;;) { this.type(Discard, LV.Lowest, {}, {}); if (this.tok !== K.CommaToken) break; this.next(); }
    this.expect(K.GreaterThanToken);
    return true;
  }
  typeParams() { if (this.tok === K.LessThanToken) this.balanced(K.LessThanToken, K.GreaterThanToken); }
  returnType() { this.type(Discard, LV.Lowest, { isReturn: true }, {}); }
  parenOrFn(S, out) {
    const mark = this.save();
    this.balanced(K.OpenParenToken, K.CloseParenToken);
    if (this.tok === K.EqualsGreaterThanToken) { this.next(); this.returnType(); S.functionType(out); return; }
    this.restore(mark);
    this.expect(K.OpenParenToken);
    const inner = S.nested(out);
    this.type(S, LV.Lowest, {}, inner);
    S.parenthesized(out, inner);
    this.expect(K.CloseParenToken);
  }
  conditionalOfOperand() {
    this.next();
    this.type(Discard, LV.Lowest, { disallow: true }, {});
    this.expect(K.QuestionToken);
    this.type(Discard, LV.Lowest, {}, {});
    this.expect(K.ColonToken);
    this.type(Discard, LV.Lowest, {}, {});
  }
  type(S, level, opts, out) {
    const isNew = this.isNew;
    const Sub = Discard;
    prefix: for (;;) {
      const t = this.tok;
      if (t === K.NumericLiteral) { this.next(); S.literal(out, "MNumber"); }
      else if (t === K.BigIntLiteral) { this.next(); S.literal(out, "MBigint"); }
      else if (t === K.StringLiteral || t === K.NoSubstitutionTemplateLiteral) { this.next(); S.literal(out, "MString"); }
      else if (this.isKw("true") || this.isKw("false")) { this.next(); S.literal(out, "MBoolean"); }
      else if (this.isKw("null")) { this.next(); S.keyword(out, "MNull"); }
      else if (this.isKw("void")) { this.next(); S.keyword(out, "MVoid"); }
      else if (this.isKw("const")) { this.next(); }
      else if (this.isKw("this")) {
        this.next();
        if (this.ctx("is") && !this.nl) { this.next(); this.type(Sub, LV.Lowest, {}, {}); if (isNew) S.typePredicate(out, false); return; }
        S.keyword(out, "MObject");
      }
      else if (t === K.MinusToken) {
        this.next();
        if (this.tok === K.BigIntLiteral) { this.next(); S.literal(out, "MBigint"); } else { this.expect(K.NumericLiteral); S.literal(out, "MNumber"); }
      }
      else if (t === K.AmpersandToken || t === K.BarToken) { this.next(); continue; }
      else if (this.isKw("import")) {
        this.next();
        this.expect(K.OpenParenToken); this.expect(K.StringLiteral);
        if (this.tok === K.CommaToken) { this.next(); this.balanced(K.OpenBraceToken, K.CloseBraceToken); if (this.tok === K.CommaToken) this.next(); }
        this.expect(K.CloseParenToken);
        if (isNew) S.importType(out);
      }
      else if (this.isKw("new")) { this.next(); this.typeParams(); this.parenOrFn(S, out); }
      else if (t === K.LessThanToken) { this.typeParams(); this.parenOrFn(S, out); }
      else if (t === K.OpenParenToken) { this.parenOrFn(S, out); }
      else if (this.isIdent()) {
        const kind = Object.hasOwn(KIND, this.word) ? KIND[this.word] : "Normal";
        const name = this.word;
        let checkTypeParameters = true;
        let isAsserts = false;
        if (kind === "PrefixKeyof" || kind === "PrefixReadonly") {
          this.next();
          this.type(Sub, LV.Prefix, {}, {});
          if (isNew && opts.disallow && this.isKw("extends") && !this.nl) this.conditionalOfOperand();
          if (kind === "PrefixKeyof") S.keyofType(out); else S.readonlyType(out);
          break prefix;
        } else if (kind === "Infer") {
          this.next();
          if (!this.isIdent()) this.fail("infer name");
          this.next();
          if (this.isKw("extends")) {
            const mark = this.save();
            try {
              this.next();
              this.type(Sub, LV.Prefix, { disallow: true }, {});
              if (!opts.disallow && this.tok === K.QuestionToken) throw new Reject("backtrack");
            } catch (e) { if (!(e instanceof Reject)) throw e; this.restore(mark); }
          }
          break prefix;
        } else if (kind === "Unique") {
          this.next();
          if (isNew) {
            if (this.ctx("symbol") || (this.tok === K.OpenBracketToken && !this.nl)) {
              this.type(Sub, LV.Prefix, {}, {});
              S.uniqueType(out);
              break prefix;
            }
          } else if (this.ctx("symbol")) { this.next(); break prefix; }
        } else if (kind === "Abstract") {
          this.next();
          if (this.isKw("new")) continue;
        } else if (kind === "Asserts") {
          this.next();
          if (opts.isReturn && !this.nl && (this.isIdent() || this.isKw("this"))) {
            this.next();
            if (isNew) { isAsserts = true; S.typePredicate(out, true); }
            if (this.nl && this.ctx("is")) {
              const mark = this.save();
              this.next();
              if (this.startOfPredicateType()) { this.type(Discard, LV.Lowest, {}, {}); return; }
              this.restore(mark);
            }
          }
        } else if (kind === "Normal") { S.reference(out, name); this.next(); }
        else { this.next(); checkTypeParameters = false; S.keyword(out, PRIM[kind]); }

        if (isNew && !checkTypeParameters && this.tok === K.DotToken) {
          if (kind === "Undefined") S.keyword(out, "MObject"); else S.reference(out, name);
        }
        if (this.ctx("is") && !this.nl) {
          this.next();
          this.type(Sub, LV.Lowest, {}, {});
          if (isNew) S.typePredicate(out, isAsserts);
          return;
        }
        if (checkTypeParameters && !this.nl) this.typeArgs();
      }
      else if (this.isKw("typeof")) {
        this.next();
        S.typeofQuery(out);
        if (this.isKw("import")) continue;
        if (!this.isWord()) this.fail("typeof operand");
        this.next();
        while (this.tok === K.DotToken) { this.next(); if (!this.isWord() && this.tok !== K.PrivateIdentifier) this.fail("typeof member"); this.next(); }
        if (!this.nl) this.typeArgs();
      }
      else if (t === K.OpenBracketToken) { S.tupleType(out); this.balanced(K.OpenBracketToken, K.CloseBracketToken); }
      else if (t === K.OpenBraceToken) { this.balanced(K.OpenBraceToken, K.CloseBraceToken); S.objectType(out); }
      else if (t === K.TemplateHead) { this.template(S, out); }
      else this.fail("unexpected");
      break;
    }

    for (;;) {
      const t = this.tok;
      if (t === K.BarToken) {
        if (level >= LV.BitwiseOr) return;
        this.next();
        const r = S.unionLeft(out);
        if (r.decided) this.type(Discard, LV.BitwiseOr, opts, {});
        else { this.type(S, LV.BitwiseOr, opts, out); S.unionRight(out, r.open); }
      } else if (t === K.AmpersandToken) {
        if (level >= LV.BitwiseAnd) return;
        this.next();
        const r = S.intersectionLeft(out);
        if (r.decided) this.type(Discard, LV.BitwiseAnd, opts, {});
        else { this.type(S, LV.BitwiseAnd, opts, out); S.intersectionRight(out, r.open); }
      } else if (t === K.ExclamationToken) {
        if (this.nl) return;
        this.next();
      } else if (t === K.DotToken) {
        this.next();
        if (!this.isWord()) this.fail("member");
        S.member(out, this.word, true);
        this.next();
        if (!this.nl) this.typeArgs();
      } else if (t === K.OpenBracketToken) {
        if (this.nl) return;
        this.next();
        let skipped = false;
        if (this.tok !== K.CloseBracketToken) { skipped = true; this.type(Sub, LV.Lowest, {}, {}); }
        this.expect(K.CloseBracketToken);
        S.indexOrArray(out, skipped);
      } else if (this.isKw("extends")) {
        if (this.nl || opts.disallow || (isNew && level >= LV.BitwiseOr)) return;
        this.next();
        this.type(S, LV.Lowest, { disallow: true }, S.fresh());
        this.expect(K.QuestionToken);
        const whenTrue = isNew ? S.branch() : S.fresh();
        this.type(S, LV.Lowest, {}, whenTrue);
        this.expect(K.ColonToken);
        const r = S.conditionalTrue(out, whenTrue);
        if (r.decided) this.type(Discard, LV.Lowest, {}, {});
        else { this.type(S, isNew || S.discard ? LV.Lowest : LV.BitwiseAnd, {}, out); S.conditionalFalse(out, r.open); }
      } else return;
    }
  }
  startOfPredicateType() {
    if (this.nl) return false;
    if (this.isIdent()) return !this.ctx("as") && !this.ctx("satisfies");
    return [K.StringLiteral, K.NumericLiteral, K.BigIntLiteral].includes(this.tok) || ["true", "false", "null", "void", "this", "typeof", "new", "import"].some(w => this.isKw(w));
  }
}

export function tagOf(m) {
  switch (m.k) {
    case "MNone": case "MAny": case "MUnknown": case "MObject": return "Object";
    case "MNever": case "MUndefined": case "MNull": case "MVoid": return "undefined";
    case "MString": return "String"; case "MNumber": return "Number"; case "MFunction": return "Function"; case "MBoolean": return "Boolean";
    case "MArray": return "Array"; case "MBigint": return "BigInt"; case "MSymbol": return "Symbol"; case "MPromise": return "Promise";
    case "MIdentifier": return ["BigInt", "Symbol", "Object"].includes(m.name) ? m.name : `Ref(${m.name})`;
    case "MDot": return `Ref(${m.dot.join(".")})`;
  }
  throw new Error("tag " + JSON.stringify(m));
}

// The tag of `form` as a property or parameter type, or as a return type. `end` is what must follow the type.
export function tagOfForm(form, isReturn, isNew) {
  const p = new P(form + " ;", isNew);
  const S = p.sink;
  if (isReturn && p.isIdent() && /^[ \t]*is[ \t]/.test(p.text.slice(p.s.getTokenEnd()))) {
    const kind = Object.hasOwn(KIND, p.word) ? KIND[p.word] : undefined;
    if (["PrefixKeyof", "PrefixReadonly", "Infer", "Asserts"].includes(kind)) {
      const mark = p.save();
      p.next();
      let ok = p.ctx("is") && !p.nl;
      if (ok) { p.next(); ok = p.startOfPredicateType() && !(kind === "Asserts" && p.ctx("is")); }
      p.restore(mark);
      if (ok) { p.next(); p.next(); p.type(Discard, LV.Lowest, {}, {}); if (p.tok !== K.SemicolonToken) p.fail("trailing"); return "Boolean"; }
    }
  }
  const out = S.fresh();
  p.type(S, LV.Lowest, isReturn ? { isReturn: true } : {}, out);
  if (p.tok !== K.SemicolonToken) p.fail("trailing");
  return tagOf(out);
}
