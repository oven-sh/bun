import ts from "/workspace/wt/parser/node_modules/typescript/lib/typescript.js";
const inputs = {
  LA_import_type_from: [`import type from /* c */ "m";`, "ts"],
  LA_async_arrow: [`const h = async y /* c */ => y as T;`, "ts"],
  LA_import_lookahead: [`a < b > import /* c */ ("x");`, "ts"],
  LA_jsx_arrow: [`const g = </* c */ T,>(x: T) => x;`, "tsx"],
  LA_for_of: [`for (async of /* c */ => 1;;) {}`, "ts"],
  T6_success_records: [`x = a ? (b) : c => d as /* c */ T : e;`, "ts"],
  T2_in_T6: [`x = a ? (b) : c => d < e /* c */ > f;`, "ts"],
  T1_in_T6: [`x = a ? (b) : c => </* c */ T>d;`, "ts"],
  T3_in_T6: [`x = a ? (b) : c => { switch (v) { case (k): /* c */ y; } };`, "ts"],
  T4_in_T6: [`x = a ? (b) : c => d as (/* c */ p | q)[];`, "ts"],
  decl_in_T6: [`x = a ? (b) : c => { type A = 1; interface B {} declare const z: number; function o(): void; function o() {} class K { private readonly f?: number; abstract m(): void; [k: string]: any } };`, "ts"],
  paren_conv: [`x = a ? (b, c) : (d);`, "ts"],
};
for (const [name, [src, loader]] of Object.entries(inputs)) {
  const t = new Bun.Transpiler({ loader });
  let out, err;
  try { out = t.transformSync(src); } catch (e) { err = (e.errors ? e.errors.map(x => x.message).join(" | ") : String(e.message || e)); }
  const sf = ts.createSourceFile("a." + loader, src, ts.ScriptTarget.Latest, true, loader === "tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const d = sf.parseDiagnostics.map(x => `TS${x.code}@${x.start}`);
  console.log(name.padEnd(24), "bun:", err ? "ERROR: " + err : "ok " + JSON.stringify(out.trim()), "| tsc:", d.length ? d.join(",") : "ok");
}
