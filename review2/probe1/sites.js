// Rough count: promise continuations in built-in JS that call stream.push()/emit()/a user callback.
const fs = require("fs"), path = require("path");
const roots = ["src/js/node", "src/js/internal", "src/js/builtins", "src/js/thirdparty", "src/js/bun"];
let files = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(ts|js)$/.test(e.name)) files.push(p); } });
for (const r of roots) (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(ts|js)$/.test(e.name)) files.push(p); } })(r);
let hits = [];
for (const f of files) {
  const lines = fs.readFileSync(f, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (/\.(then|\$then)\(|PromisePrototypeThen|await /.test(lines[i])) {
      const win = lines.slice(i, i + 8).join("\n");
      if (/\.push\((?!\.\.\.)[a-zA-Z_$]|\.emit\(["']data["']|\.emit\(["']message["']/.test(win) && /stream|this|self|readable|socket/i.test(win)) hits.push(f + ":" + (i + 1));
    }
  }
}
const byFile = {}; for (const h of hits) { const f = h.split(":")[0]; byFile[f] = (byFile[f] || 0) + 1; }
console.log("candidate sites:", hits.length, "in", Object.keys(byFile).length, "files");
for (const [f, n] of Object.entries(byFile).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(" ", n, f);
