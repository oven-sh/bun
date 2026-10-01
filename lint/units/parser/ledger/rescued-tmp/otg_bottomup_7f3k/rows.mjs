// Each row: [group, input, analog accepted today with the same meaning, loader, deco]
// Prints: does the input fail today, and the output of the analog (the expected output after the fix).
const DECO = JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } });
const T = {
  ts: new Bun.Transpiler({ loader: "ts" }),
  tsx: new Bun.Transpiler({ loader: "tsx" }),
  tsdeco: new Bun.Transpiler({ loader: "ts", tsconfig: DECO }),
};
const run = (src, k) => { try { return { ok: true, out: T[k].transformSync(src) }; } catch (e) { const l = e?.errors?.length ? e.errors : [e]; return { ok: false, err: l.map(x => x.message).join(" | ") }; } };
const rows = [
  // contextual keywords
  ["keyword", "type as = 1; export const v = 1;", "type T = 1; export const v = 1;"],
  ["keyword", "type as<T> = T; export const v = 1;", "type A<T> = T; export const v = 1;"],
  ["keyword", "type satisfies = 1; export const v = 1;", "type T = 1; export const v = 1;"],
  ["keyword", "type as\n= 1; export const v = 1;", "type T\n= 1; export const v = 1;"],
  ["keyword", "interface as {} export const v = 1;", "interface A {} export const v = 1;"],
  ["keyword", "interface satisfies { a: 1 } export const v = 1;", "interface A { a: 1 } export const v = 1;"],
  ["keyword", "interface as<T> extends B<T> {} export const v = 1;", "interface A<T> extends B<T> {} export const v = 1;"],
  ["keyword", "interface as extends B {} export const v = 1;", "interface A extends B {} export const v = 1;"],
  ["keyword", "namespace as { export const x = 1 }", "namespace A { export const x = 1 }"],
  ["keyword", "namespace satisfies { export const x = 1 }", "namespace A { export const x = 1 }"],
  ["keyword", "namespace as.b { export const x = 1 }", "namespace A.b { export const x = 1 }"],
  ["keyword", "module as { export const x = 1 }", "module A { export const x = 1 }"],
  ["keyword", "declare type as = 1; export const v = 1;", "declare type T = 1; export const v = 1;"],
  ["keyword", "declare interface as {} export const v = 1;", "declare interface A {} export const v = 1;"],
  ["keyword", "declare namespace as { const x: number } export const v = 1;", "declare namespace A { const x: number } export const v = 1;"],
  ["keyword", "declare module as { const x: number } export const v = 1;", "declare module A { const x: number } export const v = 1;"],
  ["keyword", "export interface as {} export const v = 1;", "export interface A {} export const v = 1;"],
  ["keyword", "export namespace as { export const x = 1 }", "export namespace A { export const x = 1 }"],
  ["keyword", "export declare type as = 1; export const v = 1;", "export declare type T = 1; export const v = 1;"],
  ["keyword", "export declare namespace as {} export const v = 1;", "export declare namespace A {} export const v = 1;"],
  ["keyword", "namespace N { type as = 1; export const v = 1 }", "namespace N { type T = 1; export const v = 1 }"],
  ["keyword", "function f() { type as = 1; interface as {} return 1 }", "function f() { type T = 1; interface A {} return 1 }"],
  ["keyword", "abstract declare class C {} export const v = 1;", "declare abstract class C {} export const v = 1;"],
  ["keyword", "export abstract declare class C {} export const v = 1;", "export declare abstract class C {} export const v = 1;"],
  ["keyword", "@d abstract declare class C {} export const v = 1;", "@d declare abstract class C {} export const v = 1;"],
  ["keyword", "var declare = 1, T; function f() { declare }", "var declare = 1, T; function f() { declare; }"],
  ["keyword", "var declare = 1, T; declare as T", "var declare = 1, T; declare\nas; T"],
  ["keyword", "var declare = 1; declare", "var declare = 1; declare\n"],
  // meaning changes (accepted today)
  ["changed", "interface as {}\nfoo()", "interface A {}\nfoo()"],
  ["changed", "interface as {} + 1", "interface A {} + 1"],
  ["changed", "namespace as {}", "namespace A {}"],
  ["changed", "namespace as {}\nfoo()", "namespace A {}\nfoo()"],
  ["changed", "module as {}\nfoo()", "module A {}\nfoo()"],
  ["changed", "export namespace as {}", "export namespace A {}"],
  // must keep (B class)
  ["keep", "type as T; export const v = 1;", null],
  ["keep", "type as <T>(x: T) => void; export const v = 1;", null],
  ["keep", "type satisfies T; export const v = 1;", null],
  ["keep", "interface as T\nfoo()", null],
  ["keep", "namespace as T; export const v = 1;", null],
  ["keep", "export type as = 1; export const v = 1;", null],
  ["keep", "declare as T; export const v = 1;", null],
  ["keep", "declare @d class C {} export const v = 1;", null],
  ["keep", "declare; export const v = 1;", null],
  ["keep", "type\nas = 1", null],
  ["keep", "type => 1", null],
  ["keep", "type = 1", null],
  ["keep", "abstract\nclass C {}", null],
];
for (const [g, input, analog, k = "ts"] of rows) {
  const a = run(input, k);
  const b = analog === null ? null : run(analog, k);
  console.log(`[${g}] ${JSON.stringify(input)}`);
  console.log(`    today : ${a.ok ? "ok " + JSON.stringify(a.out) : "ERROR " + a.err}`);
  if (b) console.log(`    expect: ${b.ok ? JSON.stringify(b.out) : "ANALOG ERROR " + b.err}   (analog ${JSON.stringify(analog)})`);
}
