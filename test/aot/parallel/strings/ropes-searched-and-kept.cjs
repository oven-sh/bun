// Short ropes that are searched, ordered, converted or switched over, and kept across collections.
const name = n => ["x", "width", "Margin-Left", "c", "", "größe", "Жук"][n % 7];
const key = JSON.parse("0", () => (a, b) => name(a) + "-" + name(b) + (a % 5 ? "" : name(a + b)));
const log = [0, 0, 0, 0, 0, 0, 0, 0], kept = [];
let last = "";
for (let i = 0; i < 700; i++) {
  log[0] = (log[0] * 31 + key(i, i >> 2).indexOf("-")) | 0;
  log[1] = (log[1] * 31 + key(i, i >> 2).indexOf("th", i & 3)) | 0;
  log[2] += key(i, i >> 2).includes(name(i + 1)) ? 1 : 0;
  const upper = key(i, i >> 2).toUpperCase(), lower = key(i, i >> 2).toLowerCase();
  log[3] = (log[3] * 31 + upper.length + lower.charCodeAt(lower.length - 1)) | 0;
  const s = key(i, i >> 2);
  if (s < last) log[4]++;
  if (key(i, 3) <= key(3, i)) log[5]++;
  last = s;
  switch (key(i, i >> 2)) { case "x-x": log[6]++; break; case "width-c": log[6] += 2; break; case "c-width": log[6] += 3; break; case "größe-x": log[6] += 5; }
  kept.push(s, upper, lower);
  if (i % 200 === 199) Bun.gc(true);
}
for (let i = 0; i < 700; i++) {
  const s = [name(i), "-", name(i >> 2), i % 5 ? "" : name(i + (i >> 2))].join("");
  if (kept[3 * i] !== s || kept[3 * i + 1] !== s.toUpperCase() || kept[3 * i + 2] !== s.toLowerCase()) log[7]++;
}
console.log(log.join(), kept.length, JSON.stringify(kept.slice(9, 15)));
