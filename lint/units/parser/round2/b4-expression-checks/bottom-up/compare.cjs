// usage: node compare.cjs expected.txt <lint output of run-probe.cjs> [group filter]
// For each source and loader: the first diagnostic of typescript-go against the first message of the lint parse and its entry.
// Prints one line per row: SAME (code, start, length and text agree), or what differs.
const fs = require("fs");
const read = file => {
  const map = new Map();
  let src = null;
  let group = null;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.startsWith("== ")) group = line.slice(3);
    else if (line.startsWith('"')) {
      src = line;
      if (!map.has(src)) map.set(src, { group });
    } else if (src && /^  a\.(ts|js)  /.test(line)) {
      const value = line.slice(8);
      if (value.startsWith("tsc 6.0.2 differs")) continue;
      map.get(src)[line.slice(2, 6)] = value;
    }
  }
  return map;
};
const ref = read(process.argv[2]);
const got = read(process.argv[3]);
const filter = process.argv[4];
const first = text => (text === "ok" ? "ok" : text.split(" | ")[0]);
const counts = {};
for (const [src, r] of ref) {
  if (filter && !r.group.includes(filter)) continue;
  for (const loader of ["a.ts", "a.js"]) {
    const want = first(r[loader] || "?");
    const have = first(got.get(src)?.[loader] || "?");
    const entry = have === "ok" ? "ok" : (have.split(" -> ")[1] ?? "no entry");
    const same = want === entry;
    const kind = same ? "SAME" : want === "ok" ? "REF-OK" : have === "ok" ? "LINT-OK" : "DIFF";
    counts[kind] = (counts[kind] || 0) + 1;
    if (!same || process.env.ALL) console.log(`${kind.padEnd(8)} ${loader} ${src}\n           ref:  ${want}\n           lint: ${have}`);
  }
}
console.log(JSON.stringify(counts));
