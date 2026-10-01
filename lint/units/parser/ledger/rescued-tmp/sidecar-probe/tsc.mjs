import ts from "/workspace/wt/parser/node_modules/typescript/lib/typescript.js";
const inputs = {
  T1_out: [`const v = <out>x;`, "a.ts"],
  T1_comment: [`const v = </* c */ T>x;`, "a.ts"],
  T1_async_generic_fail: [`const w = async < /* c */ b;`, "a.ts"],
  T2_lt: [`a < b /* c */ > d;`, "a.ts"],
  T2_shl: [`a << b /* c */ >> d;`, "a.ts"],
  T2_new: [`new A < b /* c */ > d;`, "a.ts"],
  T2_ok_call: [`f<A /* c */>(x);`, "a.ts"],
  T3_fail: [`switch (v) { case (x): /* c */ y; }`, "a.ts"],
  T3_ok: [`const f = (x): /* c */ T => x;`, "a.ts"],
  T4_fail: [`let x: (/* c */ a | b)[] = [];`, "a.ts"],
  T4_fail_pattern: [`let y: ({ a: b /* c */ })[] = [];`, "a.ts"],
  T4_ok: [`let z: (/* c */ a: b) => void;`, "a.ts"],
  T5_fail: [`type X<T> = T extends [infer U extends /* c */ string ? 1 : 2] ? U : never;`, "a.ts"],
  T5_ok: [`type X2<T> = T extends [infer U extends /* c */ string] ? U : never;`, "a.ts"],
  T6_fail: [`x = a ? (b) : c => d as /* c */ T;`, "a.ts"],
  T6_ok: [`x = a ? (b) : c => d as /* c */ T : e;`, "a.ts"],
  T6_nested_memo: [`x = a ? (b) : c => (p ? (q) : r => s as /* c */ T);`, "a.ts"],
  T6_with_T5_memo: [`x = a ? (b) : c => d as (T extends [infer U extends string ? 1 : 2] ? U : never);`, "a.ts"],
  T6_body_block: [`x = a ? (b) : c => { interface I { m(): void } let k: I = d!; return k as /* c */ T; };`, "a.ts"],
  LA_jsx: [`const g = </* c */ T,>(x: T) => x;`, "a.tsx"],
  LA_import_type: [`import type /* c */ from "m";`, "a.ts"],
  LA_async_arrow: [`const h = async /* c */ y => y as T;`, "a.ts"],
};
function kinds(node, depth, out) {
  out.push("  ".repeat(depth) + ts.SyntaxKind[node.kind] + ` [${node.pos},${node.end})`);
  ts.forEachChild(node, c => kinds(c, depth + 1, out));
}
for (const [name, [src, file]] of Object.entries(inputs)) {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const d = sf.parseDiagnostics.map(x => `TS${x.code}@${x.start}: ${ts.flattenDiagnosticMessageText(x.messageText, " ")}`);
  console.log(name.padEnd(26), d.length ? "DIAG " + d.join(" | ") : "ok");
  if (process.argv[2] === name) { const out = []; kinds(sf, 0, out); console.log(out.join("\n")); }
}
