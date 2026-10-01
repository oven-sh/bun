// usage: node check-port.cjs out4.txt [out.txt ...]   compares missing-semicolon-port.cjs with the first diagnostic of typescript-go
// for every input of the form "<name> x" whose first diagnostic is TS1434 or TS1435 at the name.
const { spellingSuggestion, spaceSuggestion } = require("./missing-semicolon-port.cjs");
let n = 0, bad = 0;
for (const file of process.argv.slice(2)) {
  const lines = require("node:fs").readFileSync(file, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^("(?:[^"\\]|\\.)*") \[ts\]$/.exec(lines[i]);
    if (!m) continue;
    const src = JSON.parse(m[1]);
    const w = /^([^\s\\]+) x$/u.exec(src);
    if (!w) continue;
    let go = null;
    for (let j = i + 1; j < lines.length && lines[j].startsWith("   "); j++) if (lines[j].startsWith("   go ")) { go = lines[j].slice(7); break; }
    const g = /^@0\+\d+ TS(1434|1435) (?:Unexpected keyword or identifier\.|Unknown keyword or identifier\. Did you mean '(.*)'\?)$/.exec(go ?? "");
    if (!g) continue;
    n++;
    const s = spellingSuggestion(w[1]) ?? spaceSuggestion(w[1]);
    const want = g[1] === "1435" ? g[2] : null;
    if (s !== want) { bad++; console.log("DIFF", JSON.stringify(w[1]), "port:", s, "go:", want); }
  }
}
console.log(n + " names checked, " + bad + " differ");
