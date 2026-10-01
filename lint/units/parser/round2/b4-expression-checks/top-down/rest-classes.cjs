// usage: node rest-classes.cjs <changed-vs-oracle output>: the sources that have another first diagnostic than the reference, by class.
const fs = require("fs");
const lines = fs.readFileSync(process.argv[2], "utf8").split("\n");
const classes = new Map();
for (let i = 1; i < lines.length; i++) {
  const m = /^(ts|js) (".*")$/.exec(lines[i]);
  if (!m) continue;
  const ref = lines[i + 1].replace(/^\s+ref:\s+/, "").replace(/ \[\d+,\d+\)/, "");
  const norm = s => s.replace(/^\s+\w+:\s+/, "").replace(/@\[\d+,\d+\)/, "").replace(/ \[\d+,\d+\)/g, "").replace(/"(\\.|[^"\\])*"/, t => JSON.stringify(JSON.parse(t).replace(/"[^"]*"/g, '"…"').replace(/Unexpected .*/, x => (x === 'Unexpected "…"' ? x : "Unexpected <token>")).replace(/call '.*'/, "call '…'")));
  const key = `ref ${ref}  |  proto ${norm(lines[i + 3])}  |  head ${norm(lines[i + 2])}`;
  const e = classes.get(key) ?? { n: 0, ex: [] };
  e.n++; if (e.ex.length < 3) e.ex.push(`${m[1]} ${m[2]}`);
  classes.set(key, e);
}
for (const [k, e] of [...classes].sort((a, b) => b[1].n - a[1].n)) { console.log(`${String(e.n).padStart(6)}  ${k}`); for (const x of e.ex) console.log(`          ${x}`); }
