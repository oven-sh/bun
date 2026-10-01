// Research scratch: which of ESLint's own cases the installed bun rejects (full parse, not the parse pass alone).
const fs = require("fs");
const rules = ["for-direction","no-async-promise-executor","no-case-declarations","no-delete-var","no-prototype-builtins","no-setter-return","no-unsafe-finally","no-unused-labels","no-useless-catch","no-with","require-yield","no-unused-private-class-members"];
const t = new Bun.Transpiler({ loader: "js" });
for (const r of rules) {
  const j = JSON.parse(fs.readFileSync(`${r}.cases.json`, "utf8"));
  let bad = 0;
  for (const c of [...j.valid, ...j.invalid]) {
    try { t.transformSync(c.code); } catch (e) { bad++; console.log(r, "REJECT", JSON.stringify(c.code).slice(0, 140), "::", String(e.message || e).split("\n")[0].slice(0, 120)); }
  }
  console.log(r, "cases", j.valid.length + j.invalid.length, "rejected", bad);
}
