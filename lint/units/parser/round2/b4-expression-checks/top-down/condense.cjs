// usage: node condense.cjs <head-lint output> [class filter regex]: one line per row.
const fs = require("fs");
const lines = fs.readFileSync(process.argv[2], "utf8").split("\n");
const filter = process.argv[3] ? new RegExp(process.argv[3]) : null;
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (l.startsWith("== ")) { console.log(l); continue; }
  const m = /^(ts|js) (".*")$/.exec(l);
  if (!m) continue;
  const ref = lines[i + 1].replace(/^\s+ref: /, "");
  const head = lines[i + 2].replace(/^\s+head lint: /, "");
  const cls = /\[([^\]]+)\]$/.exec(head)[1];
  if (filter && !filter.test(cls)) continue;
  console.log(`${m[1]} ${m[2]} | ${ref} | ${head.slice(0, head.lastIndexOf("    [")).trim()} | ${cls}`);
}
