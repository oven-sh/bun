// The cause list of causes.mjs, with the entries that the A1 run of the release builds added.
// An entry with `explained: true` owns records that tsc rejects as a whole for a part of the source that the base
// accepts too: the change of the branch is the other part, which is valid. The title names the source of the base
// that proves it. diff.mjs prints such a row with the mark "~~" and counts it like a ruling.
import base, { tscGrammar, tscParses, validForTsc } from "./causes.mjs";
import { check, parseAs } from "./oracle.mjs";

const dialect = d => (d.api.includes(".tsx.") ? "tsx" : "ts");
const memo = new Map();
// Whether `type X = <text>;` is valid for tsc as a whole in the dialect of the api.
function validAsType(text, d) {
  const key = dialect(d) + "\n" + text;
  if (!memo.has(key)) {
    const src = `type X = ${text};`;
    memo.set(key, parseAs(src, dialect(d)).length === 0 && check(src, dialect(d), false).grammar.length === 0);
  }
  return memo.get(key);
}
// The one entry of the list of `class C implements <entry> {}` or `interface I extends <entry> {}`.
function heritageEntry(d) {
  if (d.ctx === "heritage" || d.ctx === "iextends") return d.t;
  const m = /^(?:class \w+ implements|interface \w+ extends) ([^]*) \{\}$/.exec(d.src);
  return m ? m[1] : null;
}
const codes = list => (list ?? []).map(x => x[0]);

const explained = [
  {
    id: "explained: an entry of an extends or implements list is a type, and tsc reads an expression there",
    explained: true,
    title: "the entry is valid as a type for tsc as a whole; the base takes every type of its own grammar as an entry: `interface I extends (a: A) => void {}` and `class C implements (a: A) => void {}` are accepted by both builds and rejected by tsc (TS1005)",
    match: d => d.cls === "R>A" && !tscParses(d) && heritageEntry(d) !== null && heritageEntry(d).trim() !== "" && validAsType(heritageEntry(d), d),
  },
  {
    id: "explained: the type that a function type returns is missing",
    explained: true,
    title: "the function type is valid once its return type stands there; the base reads what follows a function type of its own grammar the same way: `function f(): (a: A) =>  { return x; }`, `let f = (a): <T>() =>  => a;` and `f<<T>() => >(x);` are accepted by both builds and rejected by tsc",
    match: d =>
      d.cls === "R>A" &&
      !tscParses(d) &&
      d.t != null &&
      ["ret", "fnret", "arrowret", "targ"].includes(d.ctx) &&
      /=>\s*$/.test(d.t) &&
      validAsType(d.t + " void", d),
  },
  {
    id: "explained: a return statement outside a function",
    explained: true,
    title: "`class` is the return type, `{}` the body, and the block after it returns at the top level: `{ return null as any }` is accepted by both builds and tsc reports TS1108 for it",
    match: d => d.cls === "R>A" && tscParses(d) && tscGrammar(d)?.length > 0 && tscGrammar(d).every(g => g[0] === 1108) && /\): class \{\} \{ return\b/.test(d.src),
  },
  {
    id: "explained: type arguments before a property access in an implements or extends entry",
    explained: true,
    title: "the entry is read as an expression now; `class C implements A<B>.C {}` and `let v = A<>.C;` are accepted by both builds and tsc reports TS1477 for them",
    match: d => d.cls === "R>A" && !tscParses(d) && codes(d.tsc?.[dialect(d)]).every(c => c === 1477) && heritageEntry(d) !== null,
  },
  {
    id: "explained: delete of a name in strict mode code",
    explained: true,
    title: "the entry is read as an expression now; `class C extends [delete A] {}` and `let v = [delete A];` are accepted by both builds and tsc reports TS1102 for them",
    match: d => d.cls === "R>A" && validForTsc(d) && (d.tsc?.oth?.[dialect(d)] ?? []).includes(1102) && /\[delete [\w$]+\]/.test(d.src) && heritageEntry(d) !== null,
  },
];

const at = base.findIndex(c => c.id.startsWith("RESTORE"));
export default [...base.slice(0, at), ...explained, ...base.slice(at)];
export { tscGrammar, tscParses, validForTsc };
