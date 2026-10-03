const cases = [
  "a + b = c;", "-a = b;", "a++ = b;", "async function f() { await x = y; }", "a++ ++;", "a--.b;",
  "++ delete a.b;", "new A?.b();", "function* g() { yield*; }", "a.\nb in c;", "for (using of of []) {}",
];
for (const loader of ["ts", "js"]) {
  const t = new Bun.Transpiler({ loader });
  for (const src of cases) {
    let scan = "ok", full = "ok";
    try { t.scanImports(src); } catch (e) { scan = String(e?.errors?.[0]?.message ?? e?.message ?? e); }
    try { t.transformSync(src); } catch (e) { full = String(e?.errors?.[0]?.message ?? e?.message ?? e); }
    console.log(loader, JSON.stringify(src), "| parse pass:", scan, "| full:", full);
  }
}
console.log(Bun.revision);
