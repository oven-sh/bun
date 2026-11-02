// One read in a loop sees objects of many shapes. Some keep the name at the same place, some elsewhere, some do not have it, and some answer through a getter or a prototype.
function Point(x) { this.x = x; }
function Size(x) { this.x = x; }
function Late(x) { this.first = 0; this.x = x; }
class Base { get x() { return "getter " + this.tag; } }
class Derived extends Base { constructor(tag) { super(); this.tag = tag; } }
const proto = { x: "inherited" };

function makeWide(x) {
  const wide = {};
  for (let i = 0; i < 40; i++) wide["p" + i] = i;
  wide.x = x;
  return wide;
}

function makeAll(round) {
  const frozen = Object.freeze({ x: "frozen " + round });
  const deleted = { x: 1, y: 2 };
  delete deleted.x;
  const redefined = { x: 1 };
  Object.defineProperty(redefined, "x", { get() { return "redefined " + round; } });
  const hidden = {};
  Object.defineProperty(hidden, "x", { value: "hidden " + round, enumerable: false });
  const shadowing = Object.create(proto);
  shadowing.x = "own over inherited " + round;
  return [
    new Point("point " + round), new Size("size " + round), new Late("late " + round), { x: "literal " + round }, { x: "literal " + round, y: 0 }, { y: 0, x: "second " + round },
    { y: 0 }, {}, Object.create(null), Object.create(proto), shadowing, new Derived(round), makeWide("wide " + round), frozen, deleted, redefined, hidden,
    [round], "text", round, true, Symbol.iterator, function x() {}, new Proxy({}, { get: (_, key) => "trap " + String(key) }),
  ];
}

function readAll(list) {
  let text = "";
  for (const each of list) text += String(each.x) + ";";
  return text;
}

let last = "";
const seen = new Set();
for (let round = 0; round < 300; round++) {
  last = readAll(makeAll(round % 3));
  seen.add(last);
}
console.log(seen.size);
for (const text of seen) console.log(text);

// The shapes change while the site is warm.
const movers = [new Point("a"), new Size("b"), { x: "c" }];
console.log(readAll(movers));
Point.prototype.x = "from the prototype";
delete movers[0].x;
Object.defineProperty(movers[1], "x", { get() { return "now a getter"; } });
movers[2].x = 7;
console.log(readAll(movers));
for (let round = 0; round < 100; round++) last = readAll(movers);
console.log(last);
Object.setPrototypeOf(movers[0], { x: "another prototype" });
console.log(readAll(movers));

// A site that has learned a place on a prototype meets objects with an own value at that place.
function Holder() {}
Holder.prototype.pad = 0;
Holder.prototype.x = "on the holder";
const mixed = [];
for (let i = 0; i < 8; i++) mixed.push(new Holder());
for (let round = 0; round < 100; round++) last = readAll(mixed);
console.log(last);
mixed.push({ pad: 1, x: "own" }, { x: "own first" });
for (let round = 0; round < 100; round++) last = readAll(mixed);
console.log(last);
