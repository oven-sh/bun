for (const src of ["let g: (a = 1) => void;", "type X = (a = 1) => void;", "function f(x: (a = 1) => void) {}", "let h: { m(a = 1): void };", "interface I { m(a = 1): void }", "let k = x as (a = 1) => void;"]) {
  try { console.log("ok", JSON.stringify(new Bun.Transpiler({ loader: "ts" }).transformSync(src))); } catch (e) { console.log("ERR", JSON.stringify((e.errors ?? [e]).map(x => x.message))); }
}
