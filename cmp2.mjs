import fs from "node:fs";
const load = f => new Map(fs.readFileSync(f, "utf8").trim().split("\n").map(l => JSON.parse(l)).map(r => [r.key, r.report]));
const [fa, fb] = process.argv.slice(2);
const a = load(fa), b = load(fb);
let same = 0, diff = 0;
for (const [key, ra] of a) {
  const x = JSON.stringify(ra), y = JSON.stringify(b.get(key));
  if (x === y) same++; else { diff++; console.log("≠", key, "\n    ", fa.padEnd(18), x, "\n    ", fb.padEnd(18), y); }
}
console.log(`${fa} vs ${fb}: same ${same}, different ${diff}`);
