// A field is deleted and stored again, so that one site deletes it at several orders of the keys.
const said = [];
function again(value, times) {
  const item = { a: value, b: value + 1, c: value + 2 };
  for (let i = 0; i < times; i++) { const old = item.a; delete item.a; if ("a" in item) return "still there"; item.a = old + item.b; }
  return JSON.stringify(item);
}
function swap(item) { const x = item.a, y = item.b; delete item.a; delete item.b; item.b = x; item.a = y; return Object.keys(item).join("") + item.a + item.b; }
function round(item, turns) { let keys = ""; for (let i = 0; i < turns; i++) { const name = "abcde"[i % 5]; const value = item[name]; delete item[name]; keys += Object.keys(item).join(""); item[name] = value; } return keys + JSON.stringify(item); }
function drop(item, i) { delete item.late; item.late = i; delete item.b; item.b = i / 2; return Object.keys(item).join("") + item.b + item.late; }
class Point { constructor(x) { this.a = x; this.b = x / 2; this.c = "c"; } }
const kept = [], points = [];
for (let i = 0; i < 6; i++) { kept.push({ a: i, b: i + 1, c: i + 2, d: "d" + i, e: { i } }); points.push(new Point(i)); }
for (let i = 0; i < 300; i++) {
  const t = [again(i, i % 6), swap(kept[i % 6]), round(kept[(i + 1) % 6], i % 7), swap(points[i % 6]), drop(points[(i + 1) % 6], i), drop(kept[(i + 2) % 6], i)].join(" ");
  if (i % 37 === 0 || i > 296) said.push(t);
  if (i === 150) { Object.freeze(kept[3]); kept[3] = { c: 1, b: 2, a: 3 }; }
}
console.log(said.join("\n"));
console.log(JSON.stringify(kept), JSON.stringify(points));
