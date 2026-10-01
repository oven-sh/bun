// Groups the expected output by case and by line kind and prints one FNV-1a 64 digest per group: usage digests.mjs expected.txt
import fs from "node:fs";
const lines = fs.readFileSync(process.argv[2], "latin1").split("\n");
const M = (1n << 64n) - 1n;
const groups = new Map();
let cur = null;
function add(name, line) {
  let g = groups.get(name);
  if (!g) groups.set(name, (g = { h: 0xcbf29ce484222325n, n: 0 }));
  for (let i = 0; i < line.length; i++) g.h = ((g.h ^ BigInt(line.charCodeAt(i))) * 0x100000001b3n) & M;
  g.h = ((g.h ^ 10n) * 0x100000001b3n) & M;
  g.n++;
}
for (const line of lines) {
  if (line === "") continue;
  const kind = line.slice(0, line.indexOf(" ") < 0 ? line.length : line.indexOf(" "));
  if (kind === "CASE") cur = line.slice(5);
  if (cur !== null) add("case:" + cur, line);
  else add("kind:" + kind, line);
  if (kind === "END") cur = null;
}
for (const [name, g] of groups) console.log(name, g.h.toString(16).padStart(16, "0"), g.n);
