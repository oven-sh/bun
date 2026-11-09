// Text that is made at run time is interpreted. It meets ordinary objects and compiled ones at the same places: JSON.parse() makes an ordinary object of a shape that it sees for the first time.
function makePoint(x, y) { return { x, y }; }
class Box { constructor(w) { this.w = w; this.h = w * 2; } get area() { return this.w * this.h; } }
class Crate extends Box { constructor(w) { super(w); this.lid = true; } }
const lines = [];
const readX = new Function("o", "return o.x;");
const readBoth = new Function("o", "return o.x + ':' + o.y + ':' + o.missing;");
const list = new Function("o", "let names = ''; for (const name in o) names += name + ' '; return names;");
const listAndRead = new Function("o", "let all = ''; for (const name in o) all += name + '=' + o[name] + ' '; return all;");
const listAndDrop = new Function("o", "dropped", "let names = ''; for (const name in o) { names += name + ' '; delete o[dropped]; } return names;");
const listAndAdd = new Function("o", "let names = ''; let n = 0; for (const name in o) { names += name + ' '; if (n++ < 2) o['added' + n] = n; } return names;");
const nested = new Function("a", "b", "let all = ''; for (const first in a) for (const second in b) all += first + second + ' '; return all;");

// One site, kinds of objects in turn: each kind often enough to take the site over, then mixed.
const kinds = [
  () => JSON.parse('{"x":1,"y":2}'),
  () => makePoint(3, 4),
  () => ({ y: 5, x: 6 }),
  () => Object.assign(Object.create({ x: 7 }), { y: 8 }),
  () => { const o = makePoint(9, 10); o.extra = 11; return o; },
  () => { const o = makePoint(12, 13); delete o.x; return o; },
  () => Object.freeze(makePoint(14, 15)),
  () => [16, 17],
  () => "text",
  () => ({ get x() { return 18; }, y: 19 }),
];
let sum = "";
for (const kind of kinds) {
  let seen = new Set();
  for (let turn = 0; turn < 70; turn++) seen.add(String(readX(kind())) + "|" + readBoth(kind()));
  sum += [...seen].join(",") + ";";
}
lines.push(sum);
let mixed = 0;
for (let turn = 0; turn < 3000; turn++) { const value = readX(kinds[(turn * 7) % 7]()); mixed += typeof value === "number" ? value : 100; }
lines.push(String(mixed));

for (let turn = 0; turn < 5; turn++) {
  lines.push(list(JSON.parse('{"x":1,"y":2}')) + "|" + list(makePoint(1, 2)) + "|" + list(new Box(2)) + "|" + list(new Crate(3)) + "|" + list({}) + "|" + list([1, 2]) + "|" + list("ab"));
}
const changing = makePoint(1, 2);
lines.push(list(changing), list(changing));
changing.z = 3; lines.push(list(changing), list(changing));
delete changing.x; lines.push(list(changing), list(changing));
changing.x = 4; lines.push(list(changing), listAndRead(changing));
Object.defineProperty(changing, "y", { enumerable: false }); lines.push(list(changing), list(changing), listAndRead(changing));
Object.defineProperty(changing, "hidden", { value: 1, enumerable: false }); lines.push(list(changing));
changing[2] = "two"; lines.push(list(changing), list(changing));
for (let turn = 0; turn < 4; turn++) {
  lines.push(listAndDrop(makePoint(1, 2), "y"), listAndDrop(makePoint(1, 2), "x"), listAndDrop(new Crate(1), "lid"), listAndDrop(JSON.parse('{"x":1,"y":2}'), "y"));
  lines.push(listAndAdd(makePoint(1, 2)), listAndAdd(new Box(1)), listAndAdd(JSON.parse('{"x":1,"y":2}')));
  lines.push(nested(makePoint(1, 2), new Box(1)), nested(new Box(1), new Box(2)));
}
const above = { inherited: 1 };
const below = Object.setPrototypeOf(makePoint(1, 2), above);
lines.push(list(below), list(below));
above.later = 2; lines.push(list(below), list(below));
delete above.inherited; lines.push(list(below));
Object.setPrototypeOf(below, null); lines.push(list(below), list(below));
Box.prototype.shown = 1; lines.push(list(new Box(1)), list(new Crate(1)));
delete Box.prototype.shown; lines.push(list(new Box(1)), list(new Crate(1)));
const shadowing = Object.setPrototypeOf(makePoint(1, 2), { x: 0, z: 0 });
lines.push(list(shadowing), listAndRead(shadowing));
console.log(lines.join("\n"));
