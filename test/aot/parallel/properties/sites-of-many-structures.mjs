// Reads of names that objects of many structures have or lack, at one place: what the place remembers gives way to the tables, and comes back.
const makers = [];
for (let i = 0; i < 24; i++) { const key = "own" + i; makers.push(n => ({ [key]: n, ["b" + i]: i, shared: i % 3 === 0 ? n : undefined })); }
class A { constructor(n) { this.n = n; } get over() { return "A" + this.n; } }
class B extends A { constructor(n) { super(n); this.more = n; } shared = 1; }
class C { only = 2; over = 3; }
makers.push(n => new A(n), n => new B(n), () => new C(), n => [n], n => n, n => "text" + n, () => null, () => () => 1, n => Object.create({ over: n }), n => Object.assign(Object.create(null), { shared: n }));
const read = o => o?.shared, over = o => o?.over, lacks = o => o?.nobody, calls = o => o?.toString !== undefined;
function round(objects, f, times) { let sum = 0, text = ""; for (let t = 0; t < times; t++) for (let i = 0; i < objects.length; i++) { const value = f(objects[i]); if (typeof value === "number") sum += value; else if (t === times - 1) text += typeof value === "string" ? value : value === undefined ? "-" : typeof value; } return sum + " " + text; }
const all = n => makers.map(make => make(n));
for (let turn = 0; turn < 3; turn++) {
  const objects = all(turn), few = objects.slice(0, 3);
  console.log(turn, round(objects, read, 3000), round(objects, over, 3000), round(objects, lacks, 3000), round(objects, calls, 300));
  console.log(round(few, read, 2000), round(few, lacks, 2000), round(objects.slice(24, 27), over, 2000));
  if (turn === 0) { objects[2].shared = 7; objects[5].nobody = "got it"; delete objects[6].shared; Object.defineProperty(objects[9], "nobody", { get() { return 11; } }); console.log(round(objects, read, 500), round(objects, lacks, 500)); }
  if (turn === 1) { Object.defineProperty(A.prototype, "shared", { get() { return 1000 + this.n; }, configurable: true }); A.prototype.nobody = 3; C.prototype.shared = "c"; console.log(round(objects, read, 500), round(objects, lacks, 500), round(objects, over, 500)); }
  if (typeof Bun !== "undefined" && turn < 2) Bun.gc(true);
  console.log(round(objects, read, 400), round(objects, lacks, 400), round(objects, over, 400));
}
