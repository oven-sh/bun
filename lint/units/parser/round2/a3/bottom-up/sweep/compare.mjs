import { readFileSync } from "node:fs";
const files = readFileSync("/tmp/a3-seam/glob-files.txt", "utf8").split("\n").filter(Boolean);
const load = path => {
  const by = [new Map(), new Map()];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line) continue;
    const r = JSON.parse(line);
    if ("index" in r) by[r.config].set(r.index, r);
  }
  return by;
};
const [a, b] = [load(process.argv[2]), load(process.argv[3])];
for (const c of [0, 1]) {
  const counts = { total: 0, equal: 0, differ: 0, bothFail: 0, bothFailSameMessage: 0, onlyA: 0, onlyB: 0, missing: 0 };
  const lists = { differ: [], onlyA: [], onlyB: [], bothFailDifferentMessage: [] };
  for (const [index, ra] of a[c]) {
    if (index < 0) { console.log(`config ${c} sentinel A:`, JSON.stringify(ra.errors ?? ra.length), "B:", JSON.stringify(b[c].get(index)?.errors ?? b[c].get(index)?.length)); continue; }
    counts.total++;
    const rb = b[c].get(index);
    if (!rb) { counts.missing++; continue; }
    if (ra.errors && rb.errors) {
      counts.bothFail++;
      if (JSON.stringify(ra.errors) === JSON.stringify(rb.errors)) counts.bothFailSameMessage++;
      else lists.bothFailDifferentMessage.push([files[index], ra.errors[0], rb.errors[0]]);
    } else if (ra.errors) { counts.onlyB++; lists.onlyB.push([files[index], ra.errors[0]]); }
    else if (rb.errors) { counts.onlyA++; lists.onlyA.push([files[index], rb.errors.slice(0, 2)]); }
    else if (ra.hash === rb.hash && ra.length === rb.length) counts.equal++;
    else { counts.differ++; lists.differ.push([files[index], ra.length, rb.length]); }
  }
  console.log(`config ${c}:`, JSON.stringify(counts));
  for (const [k, v] of Object.entries(lists)) for (const e of v) console.log(`  ${k}: ${JSON.stringify(e)}`);
}
