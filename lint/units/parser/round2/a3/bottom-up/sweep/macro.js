const fs = require("node:fs");
const src = fs.readFileSync("/workspace/wt/parser/test/bundler/transpiler/macro-test.test.ts");
for (const macro of [undefined, false]) {
  try { const out = new Bun.Transpiler({ loader: "ts", macro }).transformSync(src); console.log("macro:", macro, "-> ok", out.length); }
  catch (e) { console.log("macro:", macro, "-> ERR", (e.errors ?? [e]).map(x => x.message).slice(0, 2)); }
}
const t = new Bun.Transpiler({ loader: "ts", macro: false });
try { console.log(JSON.stringify(t.transformSync('import {escapeHTML} from "bun" with {type: "macro"}; console.log(escapeHTML("<"));'))); } catch (e) { console.log("ERR", (e.errors ?? [e]).map(x => x.message)); }
const u = new Bun.Transpiler({ loader: "ts" });
try { console.log(JSON.stringify(u.transformSync('import {escapeHTML} from "bun" with {type: "macro"}; console.log(escapeHTML("<"));'))); } catch (e) { console.log("ERR", (e.errors ?? [e]).map(x => x.message)); }
