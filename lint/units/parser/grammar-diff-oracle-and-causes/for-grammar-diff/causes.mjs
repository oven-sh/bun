// The intended changes of the branch, one entry per change. diff.mjs gives a differing record to the
// first entry whose match(d) is true. d = { src, ctx, t, prod, mut, api, cls, base, next, tsc }:
//   cls   "R>A" | "A>A" | "R>R" | "A>R" | ...
//   base, next   ["o", text] | ["e", [[message, line, column], ...]] | ["s", scan] | ["i", imports]
//   tsc   the oracle record of the source: { ts, tsx, meta?, metaLoose?, chk, oth } or null
// A cause is { id, title, from, match(d) }. `from` names the commits and the test groups of the change:
// tg is test/bundler/transpiler/typescript-grammar.test.ts, tg-expressions, tg-statements and
// tg-decorator-metadata are the three files beside it.
// match(d) returns true, or a string that is appended to the id (one line of the table per string).
// An entry with `forbidden: true` owns records that must not exist: diff.mjs counts them like unexplained ones.
// An entry with `ruling: true` owns records that the rule of the run does not settle: the report names each.
import { tagOf } from "../probes/metadata.mjs";

const dialect = d => (d.api.includes(".tsx.") ? "tsx" : "ts");
const legacy = d => /\.(exp|deco)\b/.test(d.api);

// True when tsc parses the source without a diagnostic in the dialect of the api.
export const tscParses = d => d.tsc !== null && d.tsc[dialect(d)].length === 0;

// The grammar errors of the checker of tsc in the dialect and the decorator mode of the api. null: no parse, or an old oracle file.
export function tscGrammar(d) {
  if (!tscParses(d) || !d.tsc.chk) return null;
  const key = dialect(d);
  return (legacy(d) ? d.tsc.chk[key + "L"] : undefined) ?? d.tsc.chk[key] ?? null;
}

// Valid for tsc as a whole: no parse diagnostic and no grammar error of the checker.
export const validForTsc = d => tscGrammar(d)?.length === 0;

// The codes that tsc reports beside the grammar errors, for the titles of the table.
export const tscOther = d => d.tsc?.oth?.[dialect(d)] ?? [];

// The metadata calls of a Bun output, as { key, value, start, end } in emit order.
export function bunMetadataCalls(text) {
  const out = [];
  const re = /__legacyMetadataTS\w*\("(design:\w+)", /g;
  for (let m; (m = re.exec(text)); ) {
    let depth = 0;
    let i = re.lastIndex;
    for (; i < text.length; i++) {
      const c = text[i];
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") {
        if (depth === 0) break;
        depth--;
      }
    }
    out.push({ key: m[1], value: text.slice(re.lastIndex, i).replace(/\s+/g, " ").trim(), start: re.lastIndex, end: i });
  }
  return out;
}
export const bunMetadataOf = text => bunMetadataCalls(text).map(c => [c.key, c.value]);

// The text with every metadata value replaced by a mark.
function blankMetadata(text) {
  let out = "";
  let last = 0;
  for (const call of bunMetadataCalls(text)) {
    out += text.slice(last, call.start) + "<metadata>";
    last = call.end;
  }
  return out + text.slice(last);
}
const withoutImports = text => text.replace(/^import\b[^\n]*\n?/gm, "").replace(/\n{2,}/g, "\n").replace(/^\n/, "");

// Both sides accept and the outputs are equal once the metadata values are blanked.
export function onlyMetadataDiffers(d) {
  if (d.cls !== "A>A" || d.base[0] !== "o" || d.next[0] !== "o") return false;
  return bunMetadataCalls(d.next[1]).length > 0 && blankMetadata(d.base[1]) === blankMetadata(d.next[1]);
}

// The same, where an import that only the old metadata value used is gone, or one that the new value uses is kept.
function onlyMetadataAndImportsDiffer(d) {
  if (d.cls !== "A>A" || d.base[0] !== "o" || d.next[0] !== "o") return false;
  return bunMetadataCalls(d.next[1]).length > 0 && withoutImports(blankMetadata(d.base[1])) === withoutImports(blankMetadata(d.next[1]));
}

// Every metadata value that changed has the normal form of the value tsc writes for the same key, in emit order per key.
// `which` is "metaLoose" (strictNullChecks off, the rule Bun implements) or "meta" (the defaults of tsc 6).
export function changedMetadataEqualsTsc(d, which) {
  const tsc = which === "metaLoose" ? (d.tsc?.metaLoose ?? d.tsc?.meta) : d.tsc?.meta;
  if (!tsc) return false;
  const base = bunMetadataCalls(d.base[1]);
  const next = bunMetadataCalls(d.next[1]);
  if (base.length !== next.length) return false;
  const seen = {};
  const expected = {};
  for (const [key, value] of tsc) (expected[key] ??= []).push(value);
  const total = {};
  for (const call of next) total[call.key] = (total[call.key] ?? 0) + 1;
  for (let i = 0; i < next.length; i++) {
    const key = next[i].key;
    if (base[i].key !== key) return false;
    const at = (seen[key] = (seen[key] ?? -1) + 1);
    if (base[i].value === next[i].value) continue;
    if ((expected[key]?.length ?? 0) !== total[key]) return false;
    if (tagOf(next[i].value) !== tagOf(expected[key][at]) || tagOf(next[i].value).includes("?(")) return false;
  }
  return true;
}
const metadataAsTsc = d => onlyMetadataDiffers(d) && changedMetadataEqualsTsc(d, "metaLoose");

// The type whose metadata changed: the form of a generated source, else the annotation of a one-member class, else the source.
const ONE_MEMBER = [
  /^class \w+ \{ @\w+ [#\w$]+[?!]?: ([^]*?);? \}$/,
  /^class \w+ \{ @\w+ \w+\(\w+: ([^]*)\) \{\} \}$/,
  /^class \w+ \{ @\w+ \w+\(\): ([^]*) \{[^{}]*\} \}$/,
  /^@\w+ class \w+ \{ constructor\(\w+: ([^]*)\) \{\} \}$/,
];
function typeText(d) {
  if (d.t != null) return d.t;
  for (const re of ONE_MEMBER) {
    const m = re.exec(d.src);
    if (m) return m[1];
  }
  return d.src;
}
const strip = text => text.replace(/`(?:[^`\\]|\\.)*`/g, "``").replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^'\\]|\\.)*'/g, "''");
function topLevel(text) {
  let depth = 0;
  let out = "";
  for (const c of text) {
    if ("([{<".includes(c)) depth++;
    else if (")]}>".includes(c)) depth = Math.max(0, depth - 1);
    else if (depth === 0) out += c;
  }
  return out;
}

const baseSaid = d => (d.base[0] === "e" ? d.base[1][0][0] : "");
const said = (d, re) => re.test(baseSaid(d));
const has = (d, re) => re.test(d.src);
// Base rejected, next accepts, and the source is valid for tsc as a whole.
const newlyAccepted = d => d.cls === "R>A" && validForTsc(d);

// Reserved words that the type grammar of the base took for no type name.
const RESERVED = "break|case|catch|class|const|continue|debugger|default|delete|do|else|enum|export|extends|finally|for|function|if|in|instanceof|return|super|switch|throw|try|var|while|with";
const inHeritage = d => d.ctx === "heritage" || d.ctx === "iextends" || (d.ctx == null && has(d, /\b(implements|interface\s+[\w$]+(\s*<[^{]*>)?\s+extends)\b/));

// The type form of a generated source, else the source.
const inForm = (d, re) => re.test(d.t ?? d.src);
// Codes that tsc reports for a rule of syntax through error() or the binder, which no committed test accepts.
// Not here, because a committed test accepts a source with the code: 2369, 2371, 2499, 2500, 1540.
const WATCH = new Set([1102, 1141, 1147, 1164, 1194, 1210, 1212, 1213, 1214, 1215, 1228, 1245, 1262, 1267, 1344, 1355, 1359, 2452, 2463, 2680, 2681, 2730, 18012, 18024]);

// Codes that say a name, a module or a type is missing in a source that stands alone.
const NOISE = new Set([2304, 2307, 2314, 2315, 2318, 2322, 2339, 2345, 2355, 2365, 2367, 2391, 2503, 2552, 2564, 2583, 2584, 2693, 2695, 2711, 2749, 2882, 7005, 7006, 7008, 7010, 7019, 7031, 7034]);

// The first statement `interface;`, `namespace;`, `module;` or `type;` of an output, removed.
const withoutFirstKeywordStatement = text => text.replace(/(^|\n)(interface|namespace|module|type);\n?/, "$1");
const castBecameDeclaration = d => d.cls === "A>A" && d.base[0] === "o" && d.next[0] === "o" && withoutFirstKeywordStatement(d.base[1]) === d.next[1] && d.base[1] !== d.next[1];

export default [
  // ---- Records that a committed test pins and the rule of A1 does not allow. Each needs a ruling. ----
  {
    id: "ruling: cast after a declaration named as",
    ruling: true,
    title: "tsc REJECTS the source (its second statement). The first statement is now a declaration named as; the second stays the cast that the base read",
    from: "e200dc91ce; tg-statements 'stays the cast of type, interface or namespace'",
    match: d => !tscParses(d) && has(d, /^(type|interface|namespace|module) as\b[^\n]*\n\1 as\b/) && (d.cls === "R>A" || castBecameDeclaration(d)),
  },
  {
    id: "ruling: attributes of an export on the next line",
    ruling: true,
    title: "tsc 6.0.2 and typescript-go (parser.go:2613) REJECT a line break before `with` of an export; ECMAScript allows it",
    from: "e200dc91ce; tg-statements 'the attributes of a module path start on the next line' (the two export rows)",
    match: d => d.cls === "R>A" && !tscParses(d) && has(d, /\bexport\b[^\n;]*\bfrom\s*(['"])[^'"\n]*\1[ \t]*\n\s*with\s*\{/) && said(d, /^Expected "\(" but found "\{"$/),
  },
  {
    id: "ruling: attributes of a type-only import on the next line",
    ruling: true,
    title: "tsc parses; its checker reports TS2857 for the attributes of a type-only import, which the base accepts on one line",
    from: "e200dc91ce; tg-statements 'the attributes of a module path start on the next line' (import type)",
    match: d => d.cls === "R>A" && tscParses(d) && tscGrammar(d)?.length > 0 && tscGrammar(d).every(g => g[0] === 2857) && has(d, /\bimport\s+type\b[^\n;]*\n\s*with\s*\{/),
  },

  // ---- Records that must not exist. ----
  { id: "NO ORACLE RECORD", forbidden: true, title: "the oracle file has no record of the source: make the oracle again from the same corpus", match: d => d.tsc === null },
  {
    id: "RESTORE: tsc does not parse",
    forbidden: true,
    title: "base rejected, next accepts, tsc reports a parse diagnostic: keep the rejection when !S::STRICT",
    match: d => d.cls === "R>A" && !tscParses(d) && `TS${d.tsc === null ? "?" : d.tsc[dialect(d)][0][0]}`,
  },
  {
    id: "RESTORE: grammar error of the checker",
    forbidden: true,
    title: "base rejected, next accepts, tsc parses and its checker reports a grammar error: keep the rejection when !S::STRICT",
    match: d => d.cls === "R>A" && tscParses(d) && !validForTsc(d) && (tscGrammar(d) === null ? "no chk in the oracle file" : `TS${tscGrammar(d)[0][0]}`),
  },

  // ---- A>A: decorator metadata whose new value is the value of tsc (strictNullChecks off). ----
  {
    id: "metadata: a type predicate is Boolean, an assertion predicate is undefined",
    title: "x is T, this is T, asserts x, asserts x is T",
    from: "db5064cff8; tg-decorator-metadata 'a predicate on this is Boolean', 'a predicate in a return type is Boolean and an assertion is undefined'",
    match: d => metadataAsTsc(d) && /\b[\w$]+\s+is\b|\basserts\s+[\w$]+/.test(strip(typeText(d))),
  },
  {
    id: "metadata: | and & operands are the check type of a conditional type",
    title: "A | B extends C ? D : E is Conditional(Union(A, B), ...)",
    from: "f1982cf599, db5064cff8; tg-decorator-metadata 'the operands of | and & are the check type of a conditional type'",
    match: d => metadataAsTsc(d) && /[|&]/.test(topLevel(strip(typeText(d)).split(/\bextends\b/)[0]).replace(/^\s*[|&]/, "")) && /\bextends\b[^?]*\?/.test(strip(typeText(d))),
  },
  {
    id: "metadata: keyof, readonly and unique end before extends",
    title: "the operand of a type operator does not take `extends ? :`",
    from: "f1982cf599; tg-decorator-metadata 'keyof, readonly and unique end before extends'",
    match: d => metadataAsTsc(d) && /\b(keyof|readonly|unique)\b[^?]*\bextends\b[^?]*\?/.test(strip(typeText(d))),
  },
  {
    id: "metadata: the type after the colon of a conditional type takes | and &",
    title: "TypeSink::CONDITIONAL_FALSE_LEVEL is gone",
    from: "f1982cf599; tg-decorator-metadata 'the type after the colon of a conditional type takes | and &'",
    match: d => metadataAsTsc(d) && /\bextends\b[^?]*\?[^:]*:[^:]*[|&]/.test(strip(typeText(d))),
  },
  {
    id: "metadata: the branches of a conditional type merge as the operands of | do",
    title: "a conditional type serializes as the union of its branches",
    from: "db5064cff8, 328644b4c5; tg-decorator-metadata 'the branches of a conditional type merge as the operands of | do'",
    match: d => metadataAsTsc(d) && /\bextends\b[^?]*\?/.test(strip(typeText(d))),
  },
  {
    id: "metadata: a keyword before a dot is the first name of a type reference",
    title: "any.b, string.b: parser.go parseNonArrayType reads a type reference",
    from: "f1982cf599; tg-decorator-metadata 'a keyword before a dot is the first name of a type reference'",
    match: d => metadataAsTsc(d) && /\b(any|unknown|never|string|number|boolean|bigint|symbol|object|undefined|null|void)\s*\.\s*[\w$]/.test(strip(typeText(d))),
  },
  {
    id: "metadata: unique takes the whole type after it",
    title: "unique symbol[], unique [A]: TypeOperator over the postfix type",
    from: "f1982cf599; tg-decorator-metadata 'unique takes the whole type after it'",
    match: d => metadataAsTsc(d) && /\bunique\s+(symbol\s*\[|(?!symbol\b))/.test(strip(typeText(d))),
  },
  {
    id: "metadata: an import type and unique symbol are Object",
    title: "a form without a tag is Object among the operands of | and &, and before []",
    from: "db5064cff8; tg-decorator-metadata 'an import type and unique symbol are Object'",
    match: d => metadataAsTsc(d) && /\bimport\s*\(|\bunique\s+symbol\b|\binfer\s+[\w$]+/.test(strip(typeText(d))),
  },
  {
    id: "metadata: an operand of | and & counts as what it serializes to",
    title: "nested unions, never, unknown, null and dotted names among the operands",
    from: "db5064cff8, 328644b4c5; tg-decorator-metadata 'an operand of | and & counts as what it serializes to'",
    match: d => metadataAsTsc(d) && /[|&]/.test(strip(typeText(d))),
  },
  {
    id: "metadata: other type, the value of tsc",
    title: "decorator metadata whose new value equals tsc 6.0.2 with strictNullChecks off, for a type that no group above names",
    from: "f1982cf599, 761df9953e, db5064cff8",
    match: d => metadataAsTsc(d),
  },
  {
    id: "metadata: the value of tsc, and an import follows the value",
    title: "the metadata equals tsc; an import statement that only a metadata value names is kept or dropped with it",
    from: "db5064cff8",
    match: d => d.api.startsWith("t.") && onlyMetadataAndImportsDiffer(d) && changedMetadataEqualsTsc(d, "metaLoose"),
  },
  {
    id: "ruling: metadata of a source that tsc does not parse",
    ruling: true,
    title: "only metadata differs; tsc reports a parse diagnostic, so it writes no value to compare with",
    match: d => onlyMetadataDiffers(d) && d.tsc !== null && d.tsc.ts.length > 0,
  },
  {
    id: "FORBIDDEN metadata: equals tsc only with strictNullChecks on",
    forbidden: true,
    title: "the new value is the one tsc writes with its defaults, not the loose one that Bun implements",
    match: d => onlyMetadataDiffers(d) && changedMetadataEqualsTsc(d, "meta"),
  },
  {
    id: "FORBIDDEN metadata: differs from tsc",
    forbidden: true,
    title: "only metadata differs and a changed value is not the value of tsc",
    match: d => onlyMetadataDiffers(d),
  },

  // ---- A>A that is no metadata: the base read a cast where tsc reads a declaration. ----
  {
    id: "ruling: A>A a declaration named as or satisfies, where the base read a cast",
    ruling: true,
    title: "`interface as {}` and `namespace as {}` were the casts `interface as {}` and `namespace as {}` (output `interface;`); tsc reads a declaration. Not metadata",
    from: "e200dc91ce; tg 'module syntax', tg-statements 'as and satisfies name an interface', 'as and satisfies name a namespace'",
    match: d => validForTsc(d) && castBecameDeclaration(d) && has(d, /\b(interface|namespace|module|type)\s+(as|satisfies)\b/),
  },

  // ---- R>R: both reject. ----
  { id: "both reject: another error list", title: "the messages or the positions of the errors changed", from: "every commit of the type grammar", match: d => d.cls === "R>R" },

  // ---- R>A: tsc parses, no grammar error, but its checker or binder reports a rule of syntax another way. ----
  {
    id: "ruling: tsc reports a rule of syntax outside its grammar checks",
    ruling: true,
    title: "valid by the rule of A1 (parser and grammar checks report nothing); tsc as a whole reports the code. No committed test accepts such a source",
    match: d => newlyAccepted(d) && tscOther(d).some(c => WATCH.has(c)) && `TS${tscOther(d).find(c => WATCH.has(c))}`,
  },

  // ---- R>A: the source is valid for tsc as a whole. One entry per change. ----
  {
    id: "as or satisfies names a type alias, an interface or a namespace",
    title: "H15: `type as = 1`, `interface as {}`, `namespace as { ... }`",
    from: "e200dc91ce; tg 'object types', 'module syntax'; tg-statements 'as and satisfies name a type alias / an interface / a namespace'",
    match: d => newlyAccepted(d) && has(d, /\b(type|interface|namespace|module)\s+(\/\*[^]*?\*\/\s*)?(as|satisfies)\b/),
  },
  {
    id: "abstract stands before declare",
    title: "`abstract declare class C {}`",
    from: "e200dc91ce; tg 'module syntax'; tg-statements 'abstract stands before declare'",
    match: d => newlyAccepted(d) && has(d, /\babstract\s+declare\s+class\b/),
  },
  {
    id: "a string in brackets names an enum member",
    title: '`enum E { ["x"] = 1 }`',
    from: "e200dc91ce; tg 'module syntax'; tg-statements 'a string in brackets names an enum member'",
    match: d => newlyAccepted(d) && has(d, /\benum\s+[\w$]+\s*\{[^}]*\[\s*['"`]/) && said(d, /^Expected identifier but found "\["$/),
  },
  {
    id: "import starts an expression in a namespace",
    title: '`namespace N { import("x"); }`, `namespace N { import.meta; }`',
    from: "e200dc91ce; tg 'module syntax'; tg-statements 'import starts an expression in a namespace'",
    match: d => newlyAccepted(d) && has(d, /\b(namespace|module)\b[^{]*\{[^]*\bimport\s*[.(]/) && said(d, /^Expected identifier but found "[.(]"$/),
  },
  {
    id: "the attributes of an import start on the next line",
    title: '`import A from "x"\\nwith { type: "json" }`',
    from: "e200dc91ce; tg 'module syntax'; tg-statements 'the attributes of a module path start on the next line'",
    match: d => newlyAccepted(d) && has(d, /\bimport\b[^\n;]*(['"])[^'"\n]*\1[ \t]*\n\s*with\s*\{/),
  },
  {
    id: "a comma ends an index signature of a class",
    title: "`class C { [k: string]: T, }`",
    from: "2906595e0e, 1c7ca5c9e3; tg 'class members'",
    match: d => newlyAccepted(d) && said(d, /^Expected ";" but found ","$/) && has(d, /\bclass\b[^{]*\{[^]*\[[^\]]*:[^\]]*\]\s*:[^;{}]*,/),
  },
  {
    id: "accessor is a modifier without standard decorators",
    title: "`class C { accessor x: T; }` with experimentalDecorators, and in scanImports, which has no standard decorators either",
    from: "2906595e0e, 8bb586e671; tg 'class members'",
    match: d => newlyAccepted(d) && (legacy(d) || d.api.startsWith("i.")) && has(d, /\baccessor\s+[#\w$'"\[]/) && said(d, /^Expected ";" but found /),
  },
  {
    id: "a comma follows the rest parameter of a signature of a declared class",
    title: "`declare class C { m(...a,): void; }`",
    from: "2906595e0e; tg 'signatures, type parameters and type arguments'",
    match: d => newlyAccepted(d) && said(d, /^Expected "\)" but found ","$/) && has(d, /\bdeclare\b[^]*\.\.\.[^(),]*,\s*\)/),
  },
  {
    id: "out or in names a type or a type parameter",
    title: "`function f<out>() {}`, `<out>x`, `<in>x`, `<out>(x) => x`",
    from: "f1982cf599, 06e293352c; tg 'signatures, type parameters and type arguments', 'expressions'; tg-expressions 'out is the name of a type and of a type parameter of an arrow function'",
    match: d => newlyAccepted(d) && said(d, /^The modifier "(out|in)" is not valid here$/),
  },
  {
    id: "an interface extends, or a class implements, an expression",
    title: "`interface I extends a() {}`, `class C implements a() {}`: parseExpressionWithTypeArguments (tsc: TS2499, TS2500 from the checker, no grammar error)",
    from: "f8493edf35, 2906595e0e; tg 'object types', 'class members'",
    match: d => newlyAccepted(d) && inHeritage(d),
  },
  {
    id: "a reserved word is the label of a rest element of a tuple",
    title: "`[...const: A[]]`, `[...in: A[]]`",
    from: "f1982cf599; tg 'type forms'",
    match: d => newlyAccepted(d) && inForm(d, new RegExp(`\\.\\.\\.\\s*(${RESERVED})\\s*\\??\\s*:`)),
  },
  {
    id: "an import type takes type arguments and an expression in an attribute; .< stands before type arguments",
    title: '`import("x")<T>`, `typeof import("x")<C>`, `import("x").A.<T>`, `typeof a.<C>`, `import("x", { with: { a: "b" + "c" } })`',
    from: "761df9953e; tg 'type forms'",
    match: d => newlyAccepted(d) && (inForm(d, /\bimport\s*\([^()]*(\([^()]*\)[^()]*)*\)\s*</) || inForm(d, /[\w$)]\s*\.\s*</) || (inForm(d, /\bimport\s*\(/) && said(d, /^Unexpected \+$/))),
  },
  {
    id: "the type of an assertion predicate starts on the next line",
    title: "`asserts a\\nis B` in a return type",
    from: "f1982cf599; tg 'type forms'",
    match: d => newlyAccepted(d) && inForm(d, /\basserts\s+[\w$]+[ \t]*\n\s*is\b/),
  },
  {
    id: "asserts is T is the assertion about a parameter named is",
    title: "`(): asserts is A`: parseAssertsTypePredicate reads `is` as the name (tsc: TS1225 when no parameter has the name)",
    from: "f1982cf599",
    match: d => newlyAccepted(d) && inForm(d, /\basserts\s+is\b/),
  },
  {
    id: "a parameter of a signature has an initializer",
    title: "H4: `(a = 1) => void`, `{ a(b = 1): A }`, `({ a = 1 }) => void`, also as a type argument (tsc: TS2371 from the checker, no grammar error)",
    from: "f8493edf35, 0c70f54cbd, 7bd6c3cc6e, f1982cf599; tg 'object types', 'signatures, type parameters and type arguments'",
    match: d => newlyAccepted(d) && tscOther(d).includes(2371),
  },
  {
    id: "a binding pattern of a signature is read as a binding pattern",
    title: "`([a, , b]) => void`, `{ ([a, , b]): void }`, `({ a: b = 1 }: A) => void`, `({ [a]: b }: A) => void`: a hole, a default, a computed key",
    from: "f1982cf599, f8493edf35; tg 'signatures, type parameters and type arguments'",
    match: d => newlyAccepted(d) && (inForm(d, /\[[^\]]*,\s*,|\[\s*,/) || tscOther(d).includes(2842)) && inForm(d, /=>|\)\s*:/),
  },
  {
    id: "a modifier stands before a parameter that is no parameter property",
    title: "`(public a: A) => void`, `{ a(public b: B): A }`, `function f(public a: A) {}`, `class C { m(public a: A) {} }` (tsc: TS2369 from the checker, no grammar error)",
    from: "f8493edf35, 2906595e0e, f1982cf599; tg 'object types', 'signatures, type parameters and type arguments', 'class members'",
    match: d => newlyAccepted(d) && tscOther(d).includes(2369),
  },
  {
    id: "a comparison follows the type after as and satisfies",
    title: "`x as T <= y`",
    from: "9a9e92c70f; tg 'expressions'; tg-expressions 'a comparison follows the type after as and satisfies'",
    match: d => newlyAccepted(d) && has(d, /\b(as|satisfies)\s+[^;=]*<=/) && said(d, /^Unexpected =$/),
  },
  {
    id: "a colon follows an operand that ends with a parenthesis",
    title: "`a ? 1 + async(b) : c`, `a ? -<T>(b) : c`, `case -async(b):` are no arrow functions with a return type",
    from: "9a9e92c70f; tg 'expressions'; tg-expressions 'a colon after an operand that ends with a parenthesis'",
    match: d => newlyAccepted(d) && said(d, /^Unexpected :$/) && has(d, /\)\s*:/),
  },
  {
    id: "a colon follows parentheses between ? and : of a conditional",
    title: "`a ? <T>(b) : c => d`, `a ? y => (b) : c => d`, `a ? (y) => (b) : c => d`: the arrow body and the type assertion before the colon",
    from: "9a9e92c70f, 9f4f7eae70, 8a3faae08e, daa97e786d, e57ec63c80, 972712a9f9; tg 'expressions'; tg-expressions 'a colon after parentheses between the question mark and the colon of a conditional'",
    match: d => newlyAccepted(d) && said(d, /^Expected ":" but found /) && has(d, /\?[^]*\)\s*:/),
  },
  {
    id: "a reserved word is the name of a type reference",
    title: "`let x: if`, `<if>x`, `x as var`, `(): if => x`, `typeof class`, `[function]`: parseEntityName(allowReservedWords)",
    from: "761df9953e, f1982cf599; tg 'type forms', 'expressions'",
    match: d => newlyAccepted(d) && (said(d, new RegExp(`^Unexpected (${RESERVED})$|^Unexpected "const"$`)) || (d.t != null ? inForm(d, new RegExp(`(^|[^\\w$.#])(${RESERVED})\\b`)) : has(d, new RegExp(`[:<|&(]\\s*(${RESERVED})\\b|\\b(as|satisfies|typeof|keyof)\\s+(${RESERVED})\\b`)))),
  },
  {
    id: "valid TypeScript that no entry above names",
    title: "tsc as a whole reports no rule of syntax for the source; P1.1 asks for every valid construct. Give the construct an entry of its own",
    from: "f1982cf599 and the other commits of the type grammar",
    match: d => newlyAccepted(d) && `[tsc also: ${tscOther(d).filter(c => !NOISE.has(c)).map(c => "TS" + c).join(" ") || "nothing"}]`,
  },
];
