// Newly accepted forms of class members, heritage clauses and function declarations, each with a twin:
// an input that the base build accepts today and that must print the same JavaScript.
//
// usage: <bun binary> twins.mjs [--check]
//   without --check: run with the BASE build. Prints, per row, the base result of the input (an error is
//     expected), the output of the twin, and what tsc 6.0.2 emits for the input.
//   with --check: run with the build under test. Exit 1 when a row does not print the output of its twin.
// A twin of `null` marks a row that stays rejected; `why` says which rule keeps it so.
// A row with `out` is an input that the base build accepts: it must keep printing `out`.
import ts from "/workspace/bun/node_modules/typescript/lib/typescript.js";

const DECO = JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } });
const T = { plain: new Bun.Transpiler({ loader: "ts" }), deco: new Bun.Transpiler({ loader: "ts", tsconfig: DECO }) };
// `twinCfg` is the configuration the twin runs with, when it is not the one of the input.
export const rows = [
  // index signatures of a class (parse_property.rs)
  { cfg: "plain", src: "class C { [k: string]: T, }", twin: "class C { [k: string]: T; }" },
  { cfg: "plain", src: "class C { [k: string]: T, x = 1 }", twin: "class C { [k: string]: T; x = 1 }" },
  { cfg: "plain", src: "class C { [k: string]: T, [l: number]: U }", twin: "class C { [k: string]: T; [l: number]: U }" },
  { cfg: "plain", src: "class C { static [k: string]: T, }", twin: "class C { static [k: string]: T; }" },
  { cfg: "plain", src: "declare class C { [k: string]: T, }", twin: "declare class C { [k: string]: T; }" },
  { cfg: "plain", src: "const c = class { [k: string]: T, };", twin: "const c = class { [k: string]: T; };" },
  { cfg: "plain", src: "class C { [await: string]: T; }", twin: "class C { [k: string]: T; }" },
  { cfg: "plain", src: "class C { [k: string]; }", twin: "class C { [k: string]: T; }", tsc: "TS1021" },
  { cfg: "plain", src: "class C { [k: string]\n x = 1 }", twin: "class C { [k: string]: T;\n x = 1 }", tsc: "TS1021" },
  { cfg: "plain", src: "class C { [k?: string]: T; }", twin: "class C { [k: string]: T; }", tsc: "TS1019" },
  { cfg: "plain", src: "class C { [k: string, l: number]: T; }", twin: "class C { [k: string]: T; }", tsc: "TS1096" },
  { cfg: "plain", src: "class C { [...k: string[]]: T; }", twin: "class C { [k: string]: T; }", tsc: "TS1017" },
  { cfg: "plain", src: "class C { [k,]: T; }", twin: "class C { [k: string]: T; }", tsc: "TS1022" },
  { cfg: "plain", src: "class C { []: T; }", twin: "class C { [k: string]: T; }", tsc: "TS1096" },
  { cfg: "plain", src: "class C { [k: string = f()]: T; }", twin: "class C { [k: string]: T; }", tsc: "TS1020" },
  // parameter modifiers outside a constructor (parse_fn.rs)
  { cfg: "plain", src: "function f(public a: A) {}", twin: "function f(a: A) {}", tsc: "2369" },
  { cfg: "plain", src: "function f(private a?: A, protected b = 1, readonly c: C = 2) {}", twin: "function f(a?: A, b = 1, c: C = 2) {}", tsc: "2369" },
  { cfg: "plain", src: "function f(public override readonly a: A) {}", twin: "function f(a: A) {}", tsc: "2369" },
  { cfg: "plain", src: "function f(public readonly) {}", twin: "function f(readonly) {}", tsc: "2369" },
  { cfg: "plain", src: "function f(public a\n: A) {}", twin: "function f(a\n: A) {}", tsc: "2369" },
  { cfg: "plain", src: "function f(this: T, public a: A) {}", twin: "function f(this: T, a: A) {}", tsc: "2369" },
  { cfg: "plain", src: "const f = function (public a) {};", twin: "const f = function (a) {};", tsc: "2369" },
  { cfg: "plain", src: "const o = { m(public a: A) {}, set s(private v) {} };", twin: "const o = { m(a: A) {}, set s(v) {} };", tsc: "2369" },
  { cfg: "plain", src: "const o = { constructor(public a) {} };", twin: "const o = { constructor(a) {} };", tsc: "2369" },
  { cfg: "plain", src: "class C { m(public a: A) {} static n(private b) {} set p(readonly v) {} #q(protected z) {} }", twin: "class C { m(a: A) {} static n(b) {} set p(v) {} #q(z) {} }", tsc: "2369" },
  { cfg: "plain", src: "class C { ['constructor'](public a) {} }", twin: "class C { ['constructor'](a) {} }", tsc: "2369" },
  { cfg: "plain", src: "class C { m(public a): void; m(a: any) {} }", twin: "class C { m(a): void; m(a: any) {} }", tsc: "2369" },
  { cfg: "plain", src: "abstract class C { abstract m(public a): void; }", twin: "abstract class C { abstract m(a): void; }", tsc: "2369" },
  { cfg: "plain", src: "declare class C { m(public a): void; }", twin: "declare class C { m(a): void; }", tsc: "2369" },
  { cfg: "plain", src: "declare function f(public a: A): void;", twin: "declare function f(a: A): void;", tsc: "2369" },
  { cfg: "plain", src: "function f(public a: A): void; function f(a: any) {}", twin: "function f(a: A): void; function f(a: any) {}", tsc: "2369" },
  { cfg: "plain", src: "export default function (public a) {}", twin: "export default function (a) {}", tsc: "2369" },
  { cfg: "plain", src: "class C { constructor(public a) {} m(public b) {} }", twin: "class C { constructor(public a) {} m(b) {} }", tsc: "2369" },
  { cfg: "deco", src: "class C { m(@d public a: A) {} }", twin: "class C { m(@d a: A) {} }", tsc: "2369" },
  { cfg: "deco", src: "class C { @x m(@d public readonly a: A) {} }", twin: "class C { @x m(@d a: A) {} }", tsc: "2369" },
  { cfg: "plain", src: "class C { static constructor(public a) {} }", twin: "class C { static constructor(a) {} }", tsc: "TS1089", differs: "tsc emits a constructor that assigns this.a" },
  // a rest argument with a comma in a signature of an ambient class (parse_property.rs, mod.rs)
  { cfg: "plain", src: "declare class C { m(...a,): void; }", twin: "declare class C { m(...a): void; }" },
  { cfg: "plain", src: "declare class C { constructor(...a: A[],); }", twin: "declare class C { constructor(...a: A[]); }" },
  { cfg: "plain", src: "declare namespace N { class C { m(...a,): void } }", twin: "declare namespace N { class C { m(...a): void } }" },
  // a rest argument with a comma in a signature without a body (parse_fn.rs, the change that reads the signatures)
  { cfg: "plain", src: "class C { m(...a,): void; m(...a: any[]) {} }", twin: "class C { m(...a): void; m(...a: any[]) {} }", tsc: "TS1013" },
  { cfg: "plain", src: "function f(...a,): void; function f(...a: any[]) {}", twin: "function f(...a): void; function f(...a: any[]) {}", tsc: "TS1013" },
  // entries of an implements clause that are no types (mod.rs)
  { cfg: "plain", src: "class C implements A\n<B> {}", twin: "class C implements A<B> {}" },
  { cfg: "plain", src: "class C implements (A)<B> {}", twin: "class C {}", tsc: "2500" },
  { cfg: "plain", src: "class C implements (A as any) {}", twin: "class C {}", tsc: "2500" },
  { cfg: "plain", src: "class C implements A?.B {}", twin: "class C {}", tsc: "2500" },
  { cfg: "plain", src: "class C implements A() {}", twin: "class C {}", tsc: "2500" },
  { cfg: "plain", src: "class C implements A<B>()<C> {}", twin: "class C {}", tsc: "2500" },
  { cfg: "plain", src: "class C implements A`t` {}", twin: "class C {}", tsc: "2500" },
  { cfg: "plain", src: "class C implements new A<B>() {}", twin: "class C {}", tsc: "2500" },
  { cfg: "plain", src: "class C implements A.#b {}", twin: "class C {}", tsc: "2500" },
  { cfg: "plain", src: "class C implements class B {} {}", twin: "class C {}", tsc: "2500" },
  { cfg: "plain", src: "class C implements function <T>() {} {}", twin: "class C {}", tsc: "2500" },
  { cfg: "plain", src: "class C implements import.meta {}", twin: "class C {}", tsc: "2500" },
  { cfg: "plain", src: "class C implements I, mixin<A>(B) {}", twin: "class C {}", tsc: "2500" },
  { cfg: "plain", src: "class C extends D implements f<A>(B)<C> {}", twin: "class C extends D {}", tsc: "2500" },
  { cfg: "plain", src: "const c = class implements A() {};", twin: "const c = class {};", tsc: "2500" },
  // the accessor keyword with experimentalDecorators, in a class without a decorator (parse_property.rs, mod.rs)
  { cfg: "deco", src: "class C { accessor x: T; }", twin: "class C { accessor x: T; }", twinCfg: "plain" },
  { cfg: "deco", src: "class C { accessor x = 1; }", twin: "class C { accessor x = 1; }", twinCfg: "plain" },
  { cfg: "deco", src: "class C { static accessor x = 1; }", twin: "class C { static accessor x = 1; }", twinCfg: "plain" },
  { cfg: "deco", src: "class C { accessor #x = 1; }", twin: "class C { accessor #x = 1; }", twinCfg: "plain" },
  { cfg: "deco", src: "class C { accessor [x] = 1; }", twin: "class C { accessor [x] = 1; }", twinCfg: "plain" },
  { cfg: "deco", src: "class C { public accessor x: T; y = 2; }", twin: "class C { public accessor x: T; y = 2; }", twinCfg: "plain" },
  { cfg: "deco", src: "const c = class { accessor x = 1; };", twin: "const c = class { accessor x = 1; };", twinCfg: "plain" },
  { cfg: "deco", src: "abstract class C { abstract accessor x: T; }", twin: "abstract class C { abstract accessor x: T; }", twinCfg: "plain" },
  { cfg: "deco", src: "declare class C { @d accessor x: T; }", twin: "declare class C { @d accessor x: T; }", twinCfg: "plain" },
  // rows that stay rejected
  { cfg: "deco", src: "class C { @d accessor x = 1; }", twin: null, why: "tsc calls d with the descriptor of the accessor; the visit pass has no such lowering" },
  { cfg: "deco", src: "@d class C { accessor x = 1; }", twin: null, why: "as above: a class with experimental decorators and an auto-accessor" },
  { cfg: "deco", src: "class C { accessor x = 1; m(@d a) {} }", twin: null, why: "as above" },
  { cfg: "plain", src: "class C { [public k: string]: T; }", twin: null, why: "TS1018; no modifier is read after \"[\": \"[readonly as any]\" and \"[async x => x]\" are computed names that parse today" },
  { cfg: "plain", src: "class await {}", twin: null, why: "an early error of a module in JavaScript too" },
  { cfg: "plain", src: "class C extends super.b {}", twin: null, why: "an early error in JavaScript too" },
  { cfg: "plain", src: "class C extends A.#b {}", twin: null, why: "an early error in JavaScript too" },
  { cfg: "plain", src: "function f(public\na) {}", twin: null, why: "tsc rejects: the name is on another line" },
  { cfg: "plain", src: "function f(...public a) {}", twin: null, why: "tsc rejects" },
  { cfg: "plain", src: "function f(public ...a) {}", twin: null, why: "TS1317, and the modifier would need a decision in a constructor" },
  { cfg: "plain", src: "function f(public {a}) {}", twin: null, why: "TS1187, and the modifier would need a decision in a constructor" },
  { cfg: "plain", src: "function f(static a) {}", twin: null, why: "TS1090" },
  { cfg: "plain", src: "function f(@d a) {}", twin: null, why: "TS1206: dropping the decorator would drop the call of d" },
  { cfg: "plain", src: "const o = { m(@d a) {} };", twin: null, why: "TS1206: dropping the decorator would drop the call of d" },
  { cfg: "plain", src: "function f(...a,) {}", twin: null, why: "TS1013, an early error in JavaScript too" },
  { cfg: "plain", src: "class C implements I extends B {}", twin: null, why: "TS1173: a second heritage clause needs a decision which class is extended" },
  { cfg: "plain", src: "async function f() { class C { [await: string]: T } }", twin: null, why: "tsc rejects: await is no name there" },
  // inputs that the base build accepts: the output must stay what it is
  { cfg: "plain", src: "class C { [async x => x]() {} }", out: "class C {\n  [async (x) => x]() {}\n}\n" },
  { cfg: "plain", src: "class C { [readonly as any]() {} }", out: "class C {\n  [readonly]() {}\n}\n" },
  { cfg: "plain", src: "class C { [await x]() {} }", out: "class C {\n  [await x]() {}\n}\n" },
  { cfg: "plain", src: "class C { [x ? y : z]() {} }", out: "class C {\n  [x ? y : z]() {}\n}\n" },
  { cfg: "plain", src: "class C { [k!: string]: T; }", out: "class C {\n}\n" },
  { cfg: "plain", src: "class C { [k as X: string]: T; }", out: "class C {\n}\n" },
  { cfg: "plain", src: "class C { [k: string]: T\n[l: number]: U }", out: "class C {\n}\n" },
  { cfg: "plain", src: "class C { [yield: string]: T; [static: string]: U; readonly [k: symbol]: V }", out: "class C {\n}\n" },
  { cfg: "plain", src: "function f() { class C { [await: string]: T } }", out: "function f() {\n  class C {\n  }\n}\n" },
  { cfg: "plain", src: "function f(public) {}", out: "function f(public) {}\n" },
  { cfg: "plain", src: "function f(public: number, readonly = 1, override?) {}", out: "function f(public, readonly = 1, override) {}\n" },
  { cfg: "plain", src: "class C { constructor(public\nx) {} }", out: "class C {\n  x;\n  constructor(x) {\n    this.x = x;\n  }\n}\n" },
  { cfg: "plain", src: "class C { constructor(...public x) {} }", out: "class C {\n  x;\n  constructor(...x) {\n    this.x = x;\n  }\n}\n" },
  { cfg: "plain", src: "class C { constructor(public readonly x: T, private y = 1) {} }", out: "class C {\n  x;\n  y;\n  constructor(x, y = 1) {\n    this.x = x;\n    this.y = y;\n  }\n}\n" },
  { cfg: "plain", src: "class C implements A | B, { a: 1 }, (() => void) {}", out: "class C {\n}\n" },
  { cfg: "plain", src: "class C extends D implements a.b.c<T>, I<U> {}", out: "class C extends D {\n}\n" },
  { cfg: "plain", src: "declare function f(...a,): void;", out: "" },
  { cfg: "plain", src: "class C { static constructor() {} }", out: "class C {\n  static constructor() {}\n}\n" },
  { cfg: "deco", src: "class A { accessor\n x = 1 }", out: "class A {\n  accessor;\n  x = 1;\n}\n" },
  { cfg: "deco", src: "class A { accessor; accessor2 = 1; accessor() {} }", out: "class A {\n  accessor;\n  accessor2 = 1;\n  accessor() {}\n}\n" },
  { cfg: "deco", src: "class A { @d accessor = 1 }", out: "import { __legacyDecorateClassTS as __legacyDecorateClassTS_3r173x8m, __legacyMetadataTS as __legacyMetadataTS_5qwxh4wk } from \"bun:wrap\";\n\nclass A {\n  constructor() {\n    this.accessor = 1;\n  }\n}\n__legacyDecorateClassTS_3r173x8m([\n  d,\n  __legacyMetadataTS_5qwxh4wk(\"design:type\", Object)\n], A.prototype, \"accessor\", undefined);\n" },
];

const run = (cfg, src) => {
  try {
    return { ok: T[cfg].transformSync(src) };
  } catch (e) {
    const list = e?.errors?.length ? e.errors : [e];
    return { err: String(list[0]?.message ?? list[0]) };
  }
};
const show = r => ("ok" in r ? "ok " + JSON.stringify(r.ok) : "ERR " + JSON.stringify(r.err));
const tscEmit = (cfg, src) =>
  JSON.stringify(ts.transpileModule(src, { compilerOptions: { target: "esnext", module: "esnext", experimentalDecorators: cfg === "deco", emitDecoratorMetadata: cfg === "deco", useDefineForClassFields: true } }).outputText);

if (import.meta.main) {
  const check = process.argv.includes("--check");
  console.log(`# bun ${Bun.version} ${Bun.revision}  typescript ${ts.version}${check ? "  (check)" : ""}`);
  let failed = 0;
  for (const row of rows) {
    const got = run(row.cfg, row.src);
    const want = row.out !== undefined ? { ok: row.out } : row.twin === null ? null : run(row.twinCfg ?? row.cfg, row.twin);
    if (check) {
      const pass = want === null ? "err" in got : "ok" in got && "ok" in want && got.ok === want.ok;
      if (!pass) failed++;
      console.log(`${pass ? "pass" : "FAIL"}\t${row.cfg}\t${JSON.stringify(row.src)}\t${show(got)}${pass ? "" : "\twant " + (want ? show(want) : "an error")}`);
      continue;
    }
    console.log(`${row.cfg}\t${JSON.stringify(row.src)}`);
    console.log(`    base   ${show(got)}`);
    if (row.out !== undefined) {
      console.log(`    kept   ${"ok" in got && got.ok === row.out ? "same output" : "DIFFERENT, want " + show(want)}`);
      continue;
    }
    if (want) console.log(`    twin   ${JSON.stringify(row.twin)}${row.twinCfg ? " (" + row.twinCfg + ")" : ""} -> ${show(want)}`);
    else console.log(`    stays rejected: ${row.why}`);
    if (want) console.log(`    tsc    ${row.tsc ?? "valid"}  emits ${tscEmit(row.cfg, row.src)}${row.differs ? "   DIFFERS: " + row.differs : ""}`);
  }
  if (check) {
    console.log(failed ? `${failed} rows failed` : "all rows pass");
    process.exit(failed ? 1 : 0);
  }
}
