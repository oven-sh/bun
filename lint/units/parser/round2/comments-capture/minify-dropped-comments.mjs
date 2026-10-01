const z = "z".repeat(400);
const C = `/* ${z} */`;
const tail = ` export function g(){ let longName = 1; return longName; }`;
const srcs = {
  computed_symbol: `type A = { [Symbol.iterator ${C}]: number };`,
  computed_symbol2: `type A = { [Symbol ${C} . iterator]: number };`,
  computed_string: `type B = { ["a" ${C}]: number };`,
  computed_expr: `type Cc = { [1 ${C} + 2]: number };`,
  index_sig: `type D = { [k: string ${C}]: number };`,
  mapped: `type E<T> = { [K in keyof T ${C}]: T[K] };`,
  mapped_as: `type E2<T> = { [K in keyof T as ${C} K]: T[K] };`,
  class_index: `declare class X { [key: string ${C}]: number }`,
  class_index2: `class X2 { [key: string ${C}]: number }`,
  class_index_init: `class X3 { [key: string = "a" ${C}]: number }`,
  iface_ext: `interface I extends A ${C} .B<C> {}`,
  iface_ext2: `interface I2 extends A<B ${C}> {}`,
  iface_ext_call: `interface I3 extends A ${C} ["b"] {}`,
  class_impl: `class K implements A ${C} .B<C> {}`,
  class_impl2: `class K2 implements A ${C} {}`,
  class_impl_expr: `class K3 implements (A ${C}) {}`,
  fn_type_default: `let g1: (a = 1 ${C}) => void;`,
  fn_type: `let g2: (a: number ${C}) => void;`,
  paren_type: `let g3: (A ${C} | B);`,
  ctor_type: `let g4: new (a: number ${C}) => X;`,
  obj_method: `type F = { m(a: number ${C}): void };`,
  obj_get: `type G = { get x ${C} (): number };`,
  obj_get_body: `type G2 = { get x(): number { return 1 ${C}; } };`,
  obj_prop_init: `type H = { a: number = 1 ${C} };`,
  typeof_import: `let t1: typeof import("x" ${C});`,
  import_type: `let t2: import("x" ${C}).Y;`,
  import_type_attrs: `let t3: import("x", { with: { a: "b" ${C} } }).Y;`,
  tuple_named: `let t4: [a ${C} : number, b?: string];`,
  template_type: "let t5: `a${ string " + C + " }b`;",
  infer_ext: `type J<T> = T extends [infer U extends string ${C} ? 1 : 2] ? 3 : 4;`,
  cond: `type L<T> = T extends A ${C} ? B : D;`,
  arrow_generic: `let a1 = <T ${C},>(x: T) => x;`,
  arrow_ret: `let a2 = (x): number ${C} => x;`,
  arrow_ret_cond: `let a3 = c ? (x): number ${C} => x : y;`,
  arrow_ret_cond2: `let a4 = c ? (x) : (y ${C}) => z;`,
  cast: `let c1 = <A ${C}>x;`,
  call_targs: `let c2 = f<A ${C}>(x);`,
  not_targs: `let c3 = a < b ${C} > c;`,
  async_generic: `let c4 = async <T ${C}>(x: T) => x;`,
  as_expr: `let c5 = x as A ${C};`,
  satisfies: `let c6 = x satisfies A ${C};`,
  enum_: `enum En { A = 1 ${C}, B }`,
  ns: `namespace N { export const a = 1 ${C}; }`,
  declare_fn: `declare function df(a: number ${C}): void;`,
  overload: `function ov(a: number ${C}): void; function ov(a: any) {}`,
  abstract_m: `abstract class Ab { abstract m(a: number ${C}): void; }`,
  type_as: `type as ${C} = 1;`,
  decl_named_cast_iface: `interface as ${C} { a: 1 }`,
  this_param: `function tp(this: Window ${C}, a: number) {}`,
  accessor_kw: `class Ac { accessor x ${C} = 1; }`,
  param_prop: `class Pp { constructor(public a ${C}: number) {} }`,
  definite: `let dd ${C}!: number;`,
  opt_chain_nonnull: `let oc = a!${C}.b;`,
  unique: `declare const us: unique ${C} symbol;`,
  asserts: `function as1(x: any): asserts x ${C} is string {}`,
  type_pred: `function tp1(x: any): x is ${C} string { return true; }`,
  keyword_pred: `function kp(keyof: any): keyof ${C} is string { return true; }`,
  export_type: `export type { A ${C} } from "./a";`,
  import_type_stmt: `import type { A ${C} } from "./a";`,
  import_eq: `import ie = N ${C} . A;`,
  export_as_ns: `export as ${C} namespace Foo;`,
};
const out = {};
for (const [name, src] of Object.entries(srcs)) {
  for (const loader of ["ts", "tsx"]) {
    if (loader === "tsx" && (name === "cast" || name === "arrow_generic")) continue;
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
await Bun.write(process.argv[2], JSON.stringify(out, null, 1));
console.log(Bun.revision, Object.keys(out).length);
