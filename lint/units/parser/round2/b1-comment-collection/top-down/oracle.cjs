// node oracle.cjs <out prefix> <inputs.json>...   ->  <prefix>.hex (id loader hex) and <prefix>.tsc.tsv (id, ok|diag, leading, comments)
const fs = require("fs");
const { commentsOf, loaderOf } = require("./oracle-lib.cjs");
const [prefix, ...files] = process.argv.slice(2);
const hex = [];
const tsv = [];
const seenIds = new Set();
for (const file of files) {
  const inputs = JSON.parse(fs.readFileSync(file, "utf8"));
  const tag = file.replace(/^.*notes\/lint\/units\/parser\//, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/_json$/, "");
  for (const entry of inputs) {
    let name, loader, code;
    if (entry.length === 3) [name, loader, code] = entry;
    else { [name, code] = entry; loader = loaderOf(name); }
    let id = (tag + ":" + name).replace(/\s+/g, "_");
    while (seenIds.has(id)) id += "'";
    seenIds.add(id);
    const { list, leading, diags } = commentsOf(loader, code);
    hex.push(`${id} ${loader} ${Buffer.from(code, "utf8").toString("hex")}`);
    tsv.push(`${id}\t${diags.length ? "diag " + diags.join(",") : "ok"}\t${leading}\t${list.join(",")}`);
  }
}
fs.writeFileSync(prefix + ".hex", hex.join("\n") + "\n");
fs.writeFileSync(prefix + ".tsc.tsv", tsv.join("\n") + "\n");
console.log(`${hex.length} inputs -> ${prefix}.hex, ${prefix}.tsc.tsv`);
