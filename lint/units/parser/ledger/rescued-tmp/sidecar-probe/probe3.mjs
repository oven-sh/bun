import ts from "/workspace/wt/parser/node_modules/typescript/lib/typescript.js";
const inputs = {
  LA4_for_async_of: [`for (async /* c */ of => 1;;) {}`, "ts"],
  T1_definitely_params: [`const k = <T extends /* c */ U>(x: T): T => x;`, "ts"],
  T1_cast_then_paren: [`const m = <T>(/* c */ x);`, "ts"],
  T2_ok_instantiation: [`const n = f<A /* c */>;`, "ts"],
  T2_ok_tagged: ["g<A /* c */>`t`;", "ts"],
  T3_fail_object_method: [`switch (v) { case (x as /* c */ T): y; }`, "ts"],
  wrappers_chain: [`(<A>(x as B)!)!.y satisfies C;`, "ts"],
  erased_in_case: [`switch (v) { case 1: type T = 1; interface I {} break; }`, "ts"],
  erased_single_stmt: [`if (a) type T = 1; else interface J {}`, "ts"],
  declare_global: [`declare global { interface W {} var q: number; }`, "ts"],
  declare_ns: [`declare namespace N { function f(): void; const x: number; class C { m(): void } namespace M { type T = 1 } }`, "ts"],
  declare_module: [`declare module "m" { export default function f(): void; global { var y: string } }`, "ts"],
  dts_like: [`export declare function f(a: number): string;\nexport interface I { x: number }\nexport type T = I | null;\nexport as namespace NS;`, "ts"],
  import_specs: [`import { type A, B, type C as D } from "m"; export { type A, B };`, "ts"],
  class_members: [`abstract class Q<T> extends R<T> implements S, U<T> { constructor(public readonly a: T, private b?: number) { super() } declare d: number; protected override e!: string; static accessor g = 1; }`, "ts"],
};
for (const [name, [src, loader]] of Object.entries(inputs)) {
  const t = new Bun.Transpiler({ loader });
  let out, err;
  try { out = t.transformSync(src); } catch (e) { err = (e.errors ? e.errors.map(x => x.message).join(" | ") : String(e.message || e)); }
  const sf = ts.createSourceFile("a." + loader, src, ts.ScriptTarget.Latest, true, loader === "tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const d = sf.parseDiagnostics.map(x => `TS${x.code}@${x.start}`);
  console.log(name.padEnd(24), "bun:", err ? "ERROR: " + err : "ok " + JSON.stringify(out.trim()).slice(0, 110), "| tsc:", d.length ? d.join(",") : "ok");
}
