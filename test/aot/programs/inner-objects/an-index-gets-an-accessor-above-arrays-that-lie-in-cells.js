// Arrays that lie in the cells of their objects exist, and then an index gets an accessor above them: on the prototype of all arrays or of all objects where the program may do that, on a prototype of their own in any case.
function make(i) { return { list: [i, i + 1], tag: "t" + i }; }
function makeEmpty(i) { return { list: [], tag: "e" + i }; }
const before = [];
for (let i = 0; i < 200; i++) { before.push(make(i)); before.push(makeEmpty(i)); }
let seen = 0;
const accessor = { get() { seen++; return "from above"; }, set(v) { seen += 100; }, configurable: true };
const lines = [];
for (const [name, prototype] of [["Array.prototype", Array.prototype], ["Object.prototype", Object.prototype]]) {
  let defined = true;
  try { Object.defineProperty(prototype, 4, accessor); } catch (error) { defined = false; }
  if (!defined) continue;
  const after = make(1000);
  lines.push(name, before[0].list[4], before[1].list[4], after.list[4], seen);
  before[0].list[4] = 1; before[1].list[4] = 2; after.list[4] = 3;
  lines.push(seen, before[0].list.length, before[1].list.length, after.list.length, Object.keys(before[0].list).join());
  delete prototype[4];
  before[2].list[4] = 5; lines.push(before[2].list.join(), before[2].list.length);
}
const checked = lines.length > 0 ? "checked" : "refused";
const own = Object.create(Array.prototype);
Object.defineProperty(own, 3, accessor);
const a = before[10].list, b = before[11].list;
Object.setPrototypeOf(a, own); Object.setPrototypeOf(b, own);
const start = seen;
const read = [a[3], b[3], a.length, b.length];
a[3] = 1; b[3] = 2; a.push(7, 8, 9); b.push(7);
console.log(typeof checked, read.join(), seen - start, a.join(), b.join(), a.length, b.length, before[10].list === a, Array.isArray(a));
