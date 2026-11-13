// A member of a prototype that is stored again is read again after its object has grown.
const out = [];
function first() { return "first"; }
function second() { return "second"; }
function third() { return "third"; }
function call(o) { return o.get(); }
function Wide() {}
for (let i = 0; i < 12; i++) Wide.prototype["name" + i] = i;
Wide.prototype.get = first;
const wide = new Wide(), below = Object.create(Wide.prototype);
for (let i = 0; i < 40; i++) {
  for (const stored of [first, second, third]) {
    Wide.prototype.get = stored;
    out.push(call(wide), call(below));
  }
  Wide.prototype[i] = i;
  Wide.prototype.get = second;
  out.push(call(wide), Wide.prototype.get === second, wide[i]);
}
class Narrow { get() { return "declared"; } }
const narrow = new Narrow();
function store(value) { Narrow.prototype.get = value; }
for (let i = 0; i < 60; i++) {
  store(i & 1 ? first : second);
  out.push(call(narrow));
  if (i === 20) for (let j = 0; j < 12; j++) Narrow.prototype["late" + j] = j;
  if (i > 25) Narrow.prototype[i * 2] = i;
  store(i & 1 ? second : third);
  out.push(call(narrow), Narrow.prototype.get === (i & 1 ? second : third));
}
class Counted {}
for (let i = 0; i < 12; i++) Counted.prototype["name" + i] = i;
const counted = new Counted();
for (let i = 0; i < 64; i++) {
  Counted.prototype.count = i;
  Counted.prototype[i] = { held: i };
  Counted.prototype.count += 0.5;
  out.push(counted.count, counted[i].held);
}
console.log(out.join());
