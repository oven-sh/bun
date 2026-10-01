const z = "z".repeat(400);
const tail = ` export function f(){ let longName = 1; return longName + longName; }`;
const cases = {
  control_outside: [`ts`, `interface I { [a + b]: 1 } /* ${z} */` + tail],
  D2_interface_computed_in: [`ts`, `interface I { [ a + /* ${z} */ b ]: 1 }` + tail],
  D2_interface_computed_first: [`ts`, `interface I { [ /* ${z} */ a + b ]: 1 }` + tail],
  D2_type_literal_computed: [`ts`, `let v: { [ a + /* ${z} */ b ]: 1 };` + tail],
  D2_fn_type_initializer: [`ts`, `let g: (a = 1 + /* ${z} */ 2) => void;` + tail],
  D2_import_attr_value: [`ts`, `let t: import("m", { with: { type: /* ${z} */ "json" } });` + tail],
  D2_heritage_iface_expr: [`ts`, `interface I extends a /* ${z} */ .b() {}` + tail],
  D3_class_index_sig_init: [`ts`, `class C { [k: string = 1 + /* ${z} */ 2 ]: any }` + tail],
  D3_class_implements_expr: [`ts`, `class D implements a[ /* ${z} */ 0 ] {}` + tail],
  ok_class_implements_typeref: [`ts`, `class D implements a /* ${z} */ .b {}` + tail],
  ok_typeof: [`ts`, `let q: typeof a /* ${z} */ .b;` + tail],
};
for (const [name, [loader, code]] of Object.entries(cases)) {
  try {
    const t = new Bun.Transpiler({ loader, minify: { identifiers: true }, target: "browser" });
    const out = t.transformSync(code);
    const m = out.match(/let (\w+)\s*=\s*1/);
    console.log(name.padEnd(30), "local =", m ? m[1] : "?", m && m[1] === "z" ? "  <-- comment NOT subtracted (dropped from all_comments)" : "");
  } catch (e) {
    console.log(name.padEnd(30), "ERR", String(e?.errors?.[0]?.message ?? e?.message ?? e).slice(0, 100));
  }
}
