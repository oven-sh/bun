const cases = [
  "if (false) { 1 = 2; }",
  "function f(){ return; 1 = 2; }",
  "if (false) { const a = 1; a = 2; }",
  "false && (1 = 2)",
  "await 1;",
  "using x = y;",
  "@dec class A {}",
  "class A { @dec accessor x = 1 }",
  "if (true) {} else { function f(){ break; } }",
];
for (const code of cases) {
  for (const opt of [{ deadCodeElimination: true }, { deadCodeElimination: false }]) {
    for (const loader of ["js", "ts"]) {
      let r = "ok";
      try { new Bun.Transpiler({ loader, ...opt }).transformSync(code); } catch (e) { r = "ERR " + String(e.errors?.[0]?.message ?? e.message).slice(0, 60); }
      console.log(loader, JSON.stringify(opt).padEnd(30), JSON.stringify(code).padEnd(48), r);
    }
  }
}
