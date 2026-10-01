const fs = require("fs");
const cases = JSON.parse(fs.readFileSync("cases.json", "utf8"));
const exts = ["js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts"];
const by = {};
for (const line of fs.readFileSync(process.argv[2], "utf8").split("\n")) {
  const m = /^([\w]+)\.(\w+)\((\d+),(\d+)\): (\w+) ([\w-]+): (.*)$/.exec(line);
  if (!m) { if (line) console.log("?? " + line); continue; }
  (by[m[1]] ||= {})[m[2]] = ((by[m[1]] || {})[m[2]] || []).concat(`${m[3]},${m[4]} ${m[5] === "error" ? "" : m[5] + " "}${m[6]}: ${m[7]}`);
}
for (const k of Object.keys(cases)) {
  const row = by[k] || {};
  const groups = new Map();
  for (const e of exts) { const v = (row[e] || ["ok"]).join(" | "); groups.set(v, (groups.get(v) || []).concat(e)); }
  console.log(`${k}: ${JSON.stringify(cases[k])}`);
  for (const [v, es] of groups) console.log(`    [${es.length === 8 ? "all" : es.join(",")}] ${v}`);
}
