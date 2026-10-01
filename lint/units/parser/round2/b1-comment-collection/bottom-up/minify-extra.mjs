const z = "z".repeat(400);
const C = `/* ${z} */`;
const tail = ` export function g(){ let longName = 1; return longName; }`;
const srcs = {
  baseline_no_comment: `let q = 1;`,
  baseline_comment: `let q = 1; ${C}`,
  arrow_ret_paren_union: `let a5 = (x): (A ${C} | B) => x;`,
  arrow_ret_paren_union2: `let a6 = (x: number): (A | B ${C}) => x;`,
  arrow_ret_paren_array: `let a7 = (x): (A ${C} [])=> x;`,
  arrow_ret_paren_fn: `let a8 = (x): ((a: A ${C}) => void) => x;`,
  arrow_ret_paren_simple: `let a9 = (x): (A ${C}) => x;`,
  cond_arrow_paren: `let b1 = c ? (x): (A ${C} | B) => x : y;`,
  cond_arrow_paren2: `let b2 = c ? (x) : (A ${C} | B);`,
  fn_ret_paren: `function fr(x): (A ${C} | B) { return x; }`,
  var_paren_type: `let vp: (A ${C} | B) = 1;`,
  var_fn_type_default: `let vf: (a ${C} = 1) => void;`,
  var_fn_type_destructure: `let vg: ({ a ${C} }: X) => void;`,
  var_fn_type_this: `let vh: (this: X ${C}, b?: Y) => void;`,
  import_type_attr: `let t3: import("x", { with: { a: "b" ${C} } }).Y;`,
  import_type_attr_obj: `let t4: import("x", { with ${C}: { a: "b" } }).Y;`,
  iface_ext_call: `interface I3 extends A ${C} ["b"] {}`,
  iface_ext_dot: `interface I4 extends A ${C} . B {}`,
  iface_ext_generic: `interface I5 extends A<B ${C}>, C {}`,
  class_impl_call: `class K4 implements a ${C} .b() {}`,
  class_impl_idx: `class K5 implements A ${C} [0] {}`,
  class_idx_paren: `class K6 { [k: string]: (A ${C} | B) }`,
  type_member_bracket_type: `type M1 = { [k: string ${C}]: number };`,
  type_member_bracket_in: `type M2<T> = { [K in keyof T ${C}]: T[K] };`,
  type_member_computed_sym: `type M3 = { [Symbol.iterator ${C}](): void };`,
  type_member_computed_lit: `type M4 = { ["a" ${C}]: 1; [1 ${C}]: 2 };`,
  type_member_get: `type M5 = { get a ${C} (): number; set a(v: number ${C}) };`,
  jsx_in_tag: `let j1 = 1;`,
};
const out = {};
for (const [name, src] of Object.entries(srcs)) {
  for (const loader of ["ts", "tsx"]) {
    try {
      const t = new Bun.Transpiler({ loader, minify: { identifiers: true }, target: "browser" });
      const o = t.transformSync(src + tail);
      const m = o.match(/let (\w+)\s*=\s*1;\s*return/);
      out[name + "." + loader] = m ? m[1] : "?:" + o.replace(/\s+/g, " ").slice(-60);
    } catch (e) {
      out[name + "." + loader] = "ERR " + String(e?.message ?? e).split("\n")[0].slice(0, 60);
    }
  }
}
console.log(JSON.stringify(out, null, 1));
