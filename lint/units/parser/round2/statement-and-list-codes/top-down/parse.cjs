// Parses an output file of probe.cjs into records: {g, s, l, tsc:[..], chk:[..], go:[..], bun:[..], bunKind}
const fs = require("node:fs");
function parse(file) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const recs = [];
  let g = null, cur = null;
  for (const line of lines) {
    if (line.startsWith("## ")) { g = line.slice(3); continue; }
    if (line.startsWith("   ")) {
      const t = line.slice(3);
      if (t.startsWith("tsc parses; checker ")) cur.chk.push(t.slice("tsc parses; checker ".length));
      else if (t === "tsc parses") cur.tscOk = true;
      else if (t.startsWith("tsc ")) cur.tsc.push(t.slice(4));
      else if (t === "go  parses") cur.goOk = true;
      else if (t.startsWith("go  ")) cur.go.push(t.slice(4));
      else if (t === "bun accepts") cur.bunKind = "accepts";
      else if (t.startsWith("bun visit ")) { cur.bunKind = "visit"; cur.bun.push(t.slice(10)); }
      else if (t.startsWith("bun ")) { cur.bunKind = "parse"; cur.bun.push(t.slice(4)); }
      else throw new Error("?? " + line);
      continue;
    }
    if (!line) continue;
    const m = /^(".*") \[(\w+)\]$/.exec(line);
    if (!m) throw new Error("bad " + line);
    cur = { g, s: JSON.parse(m[1]), l: m[2], tsc: [], chk: [], go: [], bun: [], bunKind: null };
    recs.push(cur);
  }
  return recs;
}
module.exports = { parse };
if (require.main === module) {
  const recs = parse(process.argv[2]);
  console.log(recs.length);
}
