const t = new Bun.Transpiler({ loader: "ts" });
for (const s of [
  'namespace N { (import.meta); }',
  'namespace N { (import("x")); }',
  'namespace N { 0, import.meta; }',
  'namespace N { void import("x"); }',
  'declare namespace N { import.meta; }',
  'import.meta;',
  'import("x");',
  'namespace N { import.meta.url; import("x").then(f); }',
  'var declare = 1, T; declare as T;',
  'var declare = 1; { declare }',
  'function f(declare) { declare }',
  'function f(declare) { return declare }',
  'function f(declare: any) { declare\n}',
  'function f(declare: any) { declare; }',
  'function f(declare: any) { if (declare) { declare } }',
]) {
  try { console.log(JSON.stringify(s), "=>", JSON.stringify(t.transformSync(s))); } catch (e) { console.log(JSON.stringify(s), "=> ERROR", (e.errors?.length ? e.errors : [e]).map(x => x.message).join(" | ")); }
}
