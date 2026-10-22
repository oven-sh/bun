function Links() { this.v = 0; this.w = 1; }
const table = [];
function linksOf(i) { return table[i] ?? (table[i] = new Links()); }

function sumTwice(o) {
  const a = o.x;
  const b = o.y;
  const c = o.x;
  return a + b + c;
}

function storeThenRead(o, n) {
  o.x = n;
  o.y = n + 1;
  return o.x + o.y;
}

function Base() { this.x = 1; this.y = 2; }
function Derived() { Base.call(this); this.z = 3; this.w = 4; }
Derived.prototype = Object.create(Base.prototype);

function pushBoth(list, a, b) {
  list.push(a);
  const n = list.length;
  list.push(b);
  return n + list.length;
}

const lines = [];
function log(name, value) { lines.push(name + " " + JSON.stringify(value)); }
function attempt(name, run) {
  try { log(name, run()); } catch (error) { log(name + " throws", error instanceof TypeError); }
}

let total = 0;
for (let i = 0; i < 200; i++) total += linksOf(i & 31).w;
log("links", total);
table.length = 8;
table[40] = undefined;
for (let i = 0; i < 64; i++) total += linksOf(i).w;
log("links with holes", [total, table.length]);
Object.defineProperty(table, 50, { get() { table.length = 4; return undefined; }, set(v) { total += 1000; }, configurable: true });
total += linksOf(50).w;
log("links behind an accessor", [total, table.length]);

for (let i = 0; i < 200; i++) total += sumTwice({ x: i, y: 1 });
log("plain", total);
let reads = 0;
const shifty = { get x() { reads++; if (reads === 1) delete this.y; else this.y = 7; return reads; }, y: 5 };
log("getter deletes the next field", sumTwice(shifty));
log("again", sumTwice(shifty));
const viaPrototype = Object.create({ get x() { Object.setPrototypeOf(viaPrototype, { x: 40, y: 2 }); return 1; }, y: 100 });
log("getter replaces the prototype", sumTwice(viaPrototype));
log("again", sumTwice(viaPrototype));

for (let i = 0; i < 200; i++) total += storeThenRead({ x: 0, y: 0 }, i);
log("stores", total);
const freezing = { set x(v) { Object.freeze(this); }, get x() { return 9; }, y: 3 };
attempt("setter freezes", () => storeThenRead(freezing, 50));
log("frozen", [Object.isFrozen(freezing), freezing.y]);
const growing = { set x(v) { Object.defineProperty(this, "y", { get() { return -1; }, set(w) { total += w; }, configurable: true }); }, get x() { return 2; }, y: 3 };
log("setter redefines the next field", [storeThenRead(growing, 60), total]);

for (let i = 0; i < 200; i++) { const d = new Derived(); total += d.x + d.y + d.z + d.w; }
log("constructors", total);
Object.defineProperty(Base.prototype, "y", { set(v) { Object.defineProperty(this, "z", { value: 30, writable: false, configurable: true }); }, get() { return 20; }, configurable: true });
attempt("setter on the prototype locks a later field", () => { const odd = new Derived(); return [odd.x, odd.y, odd.z, odd.w]; });
delete Base.prototype.y;
const usual = new Derived();
log("constructors again", [usual.x, usual.y, usual.z, usual.w]);

const numbers = [];
for (let i = 0; i < 100; i++) total += pushBoth(numbers, i, i + 1);
log("push", [total, numbers.length]);
const limited = [1, 2];
Object.defineProperty(limited, "push", { value(v) { if (this.length === 2) Object.preventExtensions(this); return Array.prototype.push.call(this, v); }, configurable: true });
attempt("own push", () => pushBoth(limited, 3, 4));
log("after own push", limited.length);
console.log(lines.join("\n"));
