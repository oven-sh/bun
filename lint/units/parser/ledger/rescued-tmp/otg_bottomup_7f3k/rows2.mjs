const DECO = JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } });
const T = {
  ts: new Bun.Transpiler({ loader: "ts" }),
  tsx: new Bun.Transpiler({ loader: "tsx" }),
  tsdeco: new Bun.Transpiler({ loader: "ts", tsconfig: DECO }),
};
const run = (src, k) => { try { return { ok: true, out: T[k].transformSync(src) }; } catch (e) { const l = e?.errors?.length ? e.errors : [e]; return { ok: false, err: l.map(x => x.message).join(" | ") }; } };
const rows = [
  // conditional / arrow
  ["cond", "export const v = a ? <T>(b) : c => d;", "export const v = a ? (b) : (c) => d;"],
  ["cond", "export const v = a ? <T>(b) : (c) => d;", "export const v = a ? (b) : (c) => d;"],
  ["cond", "export const v = a ? async <T>(b) : c => d;", "export const v = a ? async(b) : (c) => d;"],
  ["cond", "export const v = a ? b => (c) : d => e;", "export const v = a ? (b) => (c) : (d) => e;"],
  ["cond", "export const v = a ? b => ({ x: b }) : c => ({ y: c });", "export const v = a ? (b) => ({ x: b }) : (c) => ({ y: c });"],
  ["cond", "export const v = a ? (b) => (c) : d => e;", "export const v = a ? (b) => (c) : (d) => e;"],
  ["cond", "export const v = a ? async b => (c) : d => e;", "export const v = a ? async (b) => (c) : (d) => e;"],
  ["cond", "export const v = a ? async (b) => (c) : d => e;", "export const v = a ? async (b) => (c) : (d) => e;"],
  ["cond", "export const v = a ? b => c => (d) : e => f;", "export const v = a ? (b) => (c) => (d) : (e) => f;"],
  ["cond", "export const v = a ? <T>(b) => (c) : d => e;", "export const v = a ? (b) => (c) : (d) => e;"],
  ["cond", "export const v = a ? (b: T) => (c) : d => e;", "export const v = a ? (b) => (c) : (d) => e;"],
  ["cond", "export const v = a ? x = (b) : c => d;", "export const v = a ? x = (b) : (c) => d;"],
  ["cond", "export const v = a ? x += (b) : c => d;", "export const v = a ? x += (b) : (c) => d;"],
  ["cond", "export const v = a ? x ??= (b) : c => d;", "export const v = a ? x ??= (b) : (c) => d;"],
  ["cond", "export const v = a ? b => x = (c) : d => e;", "export const v = a ? (b) => x = (c) : (d) => e;"],
  ["cond", "export const v = a ? b ? c : d => (e) : f => g;", "export const v = a ? b ? c : (d) => (e) : (f) => g;"],
  // unchanged neighbours
  ["cond-keep", "export const v = a ? b => (c) : d => e : f;", null],
  ["cond-keep", "export const v = a ? <T>(b) : c => d : e;", null],
  ["cond-keep", "export const v = a ? (b) : c => d;", null],
  ["cond-keep", "export const v = a ? (b) : c => d : e;", null],
  ["cond-keep", "export const v = a ? x = (b) : c => d : e;", null],
  ["cond-keep", "export const v = a ? b => { return (c) } : d => e;", null],
  ["cond-keep", "export const v = a ? async <T>(b) : c => d : e;", null],
  ["cond-keep", "export const v = b => (c);", null],
  ["cond-keep", "export const v = (b): c => d;", null],
  // as before <=
  ["as", "export const v = a as Foo <= b;", "export const v = a <= b;"],
  ["as", "export const v = a satisfies Foo <= b;", "export const v = a <= b;"],
  ["as", "export const v = a as Foo.Bar <= b;", "export const v = a <= b;"],
  ["as", "export const v = a as typeof b <= c;", "export const v = a <= c;"],
  ["as", "export const v = a as Foo<=b;", "export const v = a <= b;"],
  ["as", "export const v = a as Foo <<= b;", null],
  ["as", "export const v = a as Foo < b;", null],
  // class members
  ["class", "class C { [k: string]: T, }", "class C { [k: string]: T; }"],
  ["class", "class C { [k: string]: T, [j: number]: U }", "class C { [k: string]: T; [j: number]: U }"],
  ["class", "class C { [k: string]: T, a = 1 }", "class C { [k: string]: T; a = 1 }"],
  ["class", "class C { static [k: string]: T, b() {} }", "class C { static [k: string]: T; b() {} }"],
  ["class", "declare class C { m(...a: T[],): void } export const v = 1;", "declare class C { m(...a: T[]): void } export const v = 1;"],
  ["class", "declare class C { constructor(...a: T[],) } export const v = 1;", "declare class C { constructor(...a: T[]) } export const v = 1;"],
  ["class", "declare namespace N { class C { m(...a: T[],): void } } export const v = 1;", "declare namespace N { class C { m(...a: T[]): void } } export const v = 1;"],
  ["class", "declare abstract class C { abstract m(...a: T[],): void } export const v = 1;", "declare abstract class C { abstract m(...a: T[]): void } export const v = 1;"],
  // accessor under experimental decorators
  ["accessor", "class C { accessor a = 1 }", "class C { accessor a = 1 }", "tsdeco", "ts"],
  ["accessor", "class C { static accessor a: T }", "class C { static accessor a: T }", "tsdeco", "ts"],
  ["accessor", "export default class { accessor a = 1 }", "export default class { accessor a = 1 }", "tsdeco", "ts"],
  ["accessor", "export const v = class { accessor a = 1 }", "export const v = class { accessor a = 1 }", "tsdeco", "ts"],
  ["accessor", "class C { accessor #a = 1 }", "class C { accessor #a = 1 }", "tsdeco", "ts"],
  ["accessor", "class C { accessor [a] = 1 }", "class C { accessor [a] = 1 }", "tsdeco", "ts"],
  ["accessor", "class C { public accessor a: T }", "class C { public accessor a: T }", "tsdeco", "ts"],
  // enum
  ["enum", "enum E { [\"a\"] }", "enum E { \"a\" }"],
  ["enum", "enum E { [\"a\"] = 1 }", "enum E { \"a\" = 1 }"],
  ["enum", "enum E { ['a-b'] = 1, c }", "enum E { 'a-b' = 1, c }"],
  ["enum", "enum E { [`a`] = 1 }", "enum E { \"a\" = 1 }"],
  ["enum", "enum E { ['x'] = 1, B = E.x }", "enum E { 'x' = 1, B = E.x }"],
  ["enum", "declare enum E { [\"a\"] } export const v = 1;", "declare enum E { \"a\" } export const v = 1;"],
  ["enum", "if (x) const enum E { a }", "if (x) enum E { a }"],
  // import in namespace
  ["nsimport", "namespace N { import.meta; }", null],
  ["nsimport", "namespace N { import(\"x\"); }", null],
  ["nsimport", "namespace N { export const m = import.meta.url }", null],
  ["nsimport", "namespace N { export const m = import(\"x\") }", null],
  // decorators
  ["deco", "@d()! class C {}", "@d() class C {}"],
  ["deco", "class C { @d()! a }", "class C { @d() a }"],
  ["deco", "@d()<T>\nclass C {}", "@d()\nclass C {}"],
  ["deco", "@d<T>(1)<U>\nclass C {}", "@d(1)\nclass C {}"],
  ["deco", "class C { @d()<T>\na }", "class C { @d()\na }"],
  ["deco", "export default @d abstract class C {}", "@d export default abstract class C {}"],
  ["deco", "export default @d abstract class C {}", "@d export default abstract class C {}", "tsdeco", "tsdeco"],
];
for (const [g, input, analog, k = "ts", ka = k] of rows) {
  const a = run(input, k);
  const b = analog === null ? null : run(analog, ka);
  console.log(`[${g}]${k !== "ts" ? " (" + k + ")" : ""} ${JSON.stringify(input)}`);
  console.log(`    today : ${a.ok ? "ok " + JSON.stringify(a.out) : "ERROR " + a.err}`);
  if (b) console.log(`    expect: ${b.ok ? JSON.stringify(b.out) : "ANALOG ERROR " + b.err}   (analog ${JSON.stringify(analog)}${ka !== k ? " with " + ka : ""})`);
}
