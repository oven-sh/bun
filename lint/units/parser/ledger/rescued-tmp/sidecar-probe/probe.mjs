const inputs = {
  T1_type_params_then_paren_fail_out: `const v = <out>x;`,
  T1_type_params_then_paren_fail_comment: `const v = </* c */ T>x;`,
  T1_async_generic_fail: `const w = async < /* c */ b;`,
  T2_type_args_fail_lt: `a < b /* c */ > d;`,
  T2_type_args_fail_shl: `a << b /* c */ >> d;`,
  T2_type_args_fail_new: `new A < b /* c */ > d;`,
  T2_type_args_ok_call: `f<A /* c */>(x);`,
  T3_arrow_return_fail: `switch (v) { case (x): /* c */ y; }`,
  T3_arrow_return_ok: `const f = (x): /* c */ T => x;`,
  T4_arrow_args_in_type_fail: `let x: (/* c */ a | b)[] = [];`,
  T4_arrow_args_in_type_fail_pattern: `let y: ({ a: b /* c */ })[] = [];`,
  T4_arrow_args_in_type_ok: `let z: (/* c */ a: b) => void;`,
  T5_infer_constraint_fail: `type X<T> = T extends [infer U extends /* c */ string ? 1 : 2] ? U : never;`,
  T5_infer_constraint_ok: `type X2<T> = T extends [infer U extends /* c */ string] ? U : never;`,
  T6_snapshot_fail: `x = a ? (b) : c => d as /* c */ T;`,
  T6_snapshot_ok: `x = a ? (b) : c => d as /* c */ T : e;`,
  T6_snapshot_nested_memo: `x = a ? (b) : c => (p ? (q) : r => s as /* c */ T);`,
  T6_snapshot_with_T5_memo: `x = a ? (b) : c => d as (T extends [infer U extends string ? 1 : 2] ? U : never);`,
  T6_body_block: `x = a ? (b) : c => { interface I { m(): void } let k: I = d!; return k as /* c */ T; };`,
  LA_is_ts_arrow_fn_jsx: `const g = </* c */ T,>(x: T) => x;`,
  LA_next_token_matches_import_type: `import type /* c */ from "m";`,
  LA_async_arrow: `const h = async /* c */ y => y as T;`,
};
const mode = process.argv[2] || "ts";
for (const [name, src] of Object.entries(inputs)) {
  const loader = name.startsWith("LA_is_ts_arrow_fn_jsx") ? "tsx" : mode;
  const t = new Bun.Transpiler({ loader });
  let out, err;
  try { out = t.transformSync(src); } catch (e) { err = (e.errors ? e.errors.map(x => x.message).join(" | ") : String(e.message || e)); }
  console.log(name.padEnd(40), err ? "ERROR: " + err : "ok   -> " + JSON.stringify(out.trim()));
}
