// A cached answer for a name on a prototype chain survives changes to other names and is invalidated by every change to its own name.
// COUNTER: SiteCacheRefill <= 300
const counts = typeof aotRuntimeCounters === "function";   // Only the jsc shell can count. Elsewhere the program checks the answers alone.
function calls(...names) { let sum = 0; if (counts) for (const name of names) sum += aotOperationCount("operationAOT" + name); return sum; }
function expectBetween(what, value, low, high) { if (counts && !(value >= low && value <= high)) throw new Error(what + ": " + value + " is not in " + low + ".." + high); }
const turns = JSON.parse("4");
const box = JSON.parse("[0]"); function hidden(value) { box[0] = value; return box[0]; }
function byName() { return calls("GetByIdAndCache", "PutByIdAndCache", "FillSiteCache"); }

const chain = [Object.create(null)];
for (let k = 1; k < 6; k++) chain[k] = Object.create(chain[k - 1]);
const far = chain[0];
const middle = chain[3];
const near = chain[5];
far.value = 10;
far.method = function () { return 1; };
Object.defineProperty(far, "computed", { get() { return 100; }, configurable: true });

function make() {
  const objects = [];
  for (let i = 0; i < 4; i++) {
    const o = Object.create(near);
    for (let k = 0; k < i; k++) o["own" + k] = k;
    o.shared = i;
    objects.push(o);
  }
  return objects;
}
const receivers = make();
const names = JSON.parse('["value","missing","method","added"]');
const joined = names.map(name => name.slice(0, 2) + name.slice(2));
const mark = Symbol("mark");
far[mark] = 5;
const trips = turns * 4;

function readOne(o, n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += o.value + o.method() + o.computed + (o.missing === undefined ? 0 : o.missing);
  return sum;
}
function readAll(objects, n) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const o = objects[i & 3];
    sum += o.value + o.method() + o.computed + (o.missing === undefined ? 0 : o.missing);
  }
  return sum;
}
function readByKey(objects, n) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const o = objects[i & 3];
    sum += o[joined[0]] + o[mark] + (o[joined[1]] === undefined ? 0 : o[joined[1]]) + (joined[1] in o ? 1 : 0);
  }
  return sum;
}
function store(objects) {
  let sum = 0;
  for (let i = 0; i < objects.length; i++) {
    const o = objects[i];
    try {
      o.added = 1;
    } catch (error) {
      sum += error instanceof TypeError ? 2 : 3;
    }
    if (Object.hasOwn(o, "added")) sum++;
  }
  return sum;
}
function round() {
  return readOne(receivers[0], trips) + " " + readAll(receivers, trips) + " " + readByKey(receivers, trips) + " " + store(make());
}

for (let i = 0; i < 5; i++) round();
console.log("warmed up: " + round());

{
  const seen = new Set();
  const before = byName();
  for (let i = 0; i < 180; i++) {
    chain[i % 6]["unrelated" + i] = i;
    seen.add(round());
  }
  expectBetween("entries while other names change", byName() - before, 0, 400);
  console.log("while other names change: " + [...seen].join("|"));
}

function say(label, low = 1) {
  const before = byName();
  const result = round();
  expectBetween(label, byName() - before, low, 100000);
  console.log(label + ": " + result);
}
middle.value = 20; say("value added to a nearer prototype");
far.missing = 5; say("missing name added to the farthest prototype");
delete middle.value; say("nearer value deleted");
far.method = function () { return 2; }; say("method replaced", 0);
Object.defineProperty(far, "value", { get() { return 1000; }, configurable: true }); say("value redefined as a getter");
Object.defineProperty(far, "computed", { value: 7, configurable: true }); say("getter redefined as a value");
near[joined[1]] = 6; say("name added by key to the nearest prototype");
delete near.missing; say("name deleted from the nearest prototype");
middle[mark] = 50; say("symbol added to a nearer prototype", 0);
let stored = 0;
Object.defineProperty(far, "added", { set(v) { stored += v; }, configurable: true }); say("setter added"); console.log("stored through the setter: " + stored);
delete far.added; say("setter deleted");
Object.defineProperty(middle, "added", { value: 0, writable: false, configurable: true }); say("read-only property added");
delete middle.added; say("read-only property deleted");
Object.setPrototypeOf(middle, { value: 3, method() { return 4; }, computed: 5 }); say("prototype of a prototype replaced");
Object.freeze(near); say("nearest prototype frozen", 0);

class Point {
  constructor() { this.x = 1; }
  mark(v) { this.late = v; }
}
const point = hidden(new Point());
function readPoint(o, n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += o.x + (o.late === undefined ? 0 : o.late);
  return sum;
}
console.log("absent field: " + readPoint(point, trips));
Point.prototype.late = 7; console.log("field name added to the class prototype: " + readPoint(point, trips));
point.mark(8); console.log("field stored: " + readPoint(point, trips));
delete point.late; console.log("field deleted: " + readPoint(point, trips));
