const z = "z".repeat(400);
const cases = {
  ts_outside: [`ts`, `interface I { [Symbol.iterator](): void } /* ${z} */ export function f(){ let longName = 1; return longName + longName; }`],
  ts_computed_key: [`ts`, `interface I { [/* ${z} */ Symbol.iterator](): void } export function f(){ let longName = 1; return longName + longName; }`],
  ts_computed_key_after: [`ts`, `interface I { [Symbol.iterator /* ${z} */](): void } export function f(){ let longName = 1; return longName + longName; }`],
  ts_type_literal_key: [`ts`, `let v: { [/* ${z} */ K]: 1 }; export function f(){ let longName = 1; return longName + longName; }`],
  ts_class_index_sig: [`ts`, `class C { [k: string]: /* ${z} */ any } export function f(){ let longName = 1; return longName + longName; }`],
  ts_implements_expr: [`ts`, `class C implements a /* ${z} */ .b<T> {} export function f(){ let longName = 1; return longName + longName; }`],
  ts_typeof_arg: [`ts`, `let v: typeof a /* ${z} */ .b; export function f(){ let longName = 1; return longName + longName; }`],
  ts_cond_arrow: [`ts`, `export function f(c, b){ let longName = 1; return c ? (longName) : b => /* ${z} */ longName : 2; }`],
  ts_cond_not_arrow: [`ts`, `export function f(c, b){ let longName = 1; return c ? (longName) : b /* ${z} */ ; }`],
  ts_type_args_fail: [`ts`, `export function f(a, b, c){ let longName = 1; return a < /* ${z} */ b > c + longName; }`],
  ts_type_args_ok: [`ts`, `export function f(a, b, c){ let longName = 1; return a< /* ${z} */ b>(c) + longName; }`],
  ts_arrow_generic: [`ts`, `export function f(){ let longName = 1; return </* ${z} */ T>(x: T) => x + longName; }`],
  ts_cast: [`ts`, `export function f(x){ let longName = 1; return </* ${z} */ T>x + longName; }`],
};
for (const [name, [loader, code]] of Object.entries(cases)) {
  try {
    const t = new Bun.Transpiler({ loader, minify: { identifiers: true }, target: "browser" });
    const out = t.transformSync(code);
    const m = out.match(/let (\w+)\s*=\s*1/);
    console.log(name.padEnd(24), "local =", m ? m[1] : "?", "|", out.replace(/\s+/g, " ").slice(0, 90));
  } catch (e) {
    console.log(name.padEnd(24), "ERR", String(e?.message ?? e).slice(0, 100));
  }
}
