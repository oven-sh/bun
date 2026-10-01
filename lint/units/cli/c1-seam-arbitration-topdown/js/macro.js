const code = "import {m} from './m' with {type:'macro'}; const v = m(); export {v};";
for (const target of ["bun", "macro", "bun_macro", "bun-macro", "browser"]) {
  for (const extra of [{}, { macro: false }]) {
    let r;
    try { r = "ok: " + new Bun.Transpiler({ loader: "ts", target, ...extra }).transformSync(code).replace(/\n/g, " ").slice(0, 90); }
    catch (e) { r = "ERR " + String(e.errors?.[0]?.message ?? e.message).slice(0, 80); }
    console.log(target.padEnd(10), JSON.stringify(extra).padEnd(16), r);
  }
}
