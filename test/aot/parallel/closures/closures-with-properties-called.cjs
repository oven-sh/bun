// Functions that were given properties are called by their word whatever their Structure.
const lost = [x => x];
globalThis.pass = value => lost.length > 5 ? null : value;
const made = [];
for (let j = 0; j < 8; j++) {
  const kinds = [
    function (a, b) { return this === globalThis ? j + (a | 0) + (b === undefined ? 1 : 2) : "this " + (this === undefined ? "u" : typeof this); },
    a => j * 2 + (a | 0),
    async a => a + j,
    function* (a) { yield a; yield j; },
    class { constructor(a) { this.a = a; } },
    (...rest) => rest.length + j,
    function (a, b, c, d, e, f) { return [a, b, c, d, e, f, arguments.length].join(); },
    { m(a) { return this ? Object.keys(this).join() + a : "none" + a; } }.m,
  ];
  const f = kinds[j];
  f.label = j;
  if (j & 1) f.other = -j;
  made.push(globalThis.pass(f));
}
const known = function (a, b) { return (a | 0) * 10 + (b | 0); };
known.label = "known";
let total = 0;
function show(value) {
  if (value && typeof value.next === "function") return [...value].join("+");
  return value instanceof Promise ? "promise" : String(value);
}
for (let round = 0; round < 40; round++) {
  const out = [];
  for (let i = 0; i < made.length; i++) {
    const f = made[i];
    for (const call of [() => f(), () => f(1), () => f(1, 2), () => f(1, 2, 3, 4, 5, 6, 7), () => f.call({ x: 1 }, 5), () => f.apply(null, [1, 2]), () => f(...[7, 8, 9]), () => ({ f, y: 1 }).f(3), () => new f(4)]) {
      try { out.push(show(call())); } catch (error) { out.push(error.constructor.name + " " + error.message.replace(/\(.*/, "")); }
    }
  }
  if (round === 39) console.log(out.join("\n"));
  total += known(round, 1) + known(round);
}
console.log(total);
// Other realms.
const vm = require("node:vm");
const context = vm.createContext({ log: [] });
const foreign = vm.runInContext("(function (a) { return [this === globalThis, a, typeof log].join(); })", context);
foreign.label = 1;
const arrow = vm.runInContext("a => a + 1", context);
arrow.label = 2;
const bound = known.bind(null, 4);
bound.label = 3;
const native = Math.max.bind(null);
native.label = 4;
const listed = [foreign, arrow, bound, native, known, made[0], made[1], parseInt, Array.isArray, vm.runInContext("Array.isArray", context)];
for (let i = 0; i < 60; i++) { const row = listed.map(f => String(f(5, 6))); if (i === 59) console.log(row.join(" ")); }
// Properties that come and go.
function flag(callback, i) { callback.flagged = i; const result = callback(i); delete callback.flagged; return result; }
let sum = 0;
for (let i = 0; i < 1000; i++) sum += flag(globalThis.pass(i & 1 ? x => x + i : function (x) { return x - i; }), i);
console.log(sum);
const kept = globalThis.pass(function kept(x) { return x; });
for (let i = 0; i < 300; i++) flag(kept, i);
console.log(Object.getOwnPropertyNames(kept).join(), "flagged" in kept, delete kept.flagged, delete kept.prototype, delete kept.name, kept.name, delete kept.length, kept.length, Object.getOwnPropertyNames(kept).join());
function two(f) { f.a = 1; f.b = 2; delete f.a; f.c = 3; delete f.b; return Object.keys(f).join() + f.c + f.a; }
const seen = new Set();
for (let i = 0; i < 400; i++) seen.add(two(globalThis.pass(i % 3 ? () => i : function () { return i; })));
console.log([...seen].join(" | "));
class Holder { static method() { return 1; } static field = 2; }
for (let i = 0; i < 50; i++) { Holder.extra = i; delete Holder.extra; }
console.log(Object.getOwnPropertyNames(Holder).join(), delete Holder.method, Holder.method, delete Holder.field, Holder.field, delete Holder.prototype === false);
const frozen = Object.freeze(Object.assign(() => 1, { a: 1 }));
console.log(delete frozen.a, frozen.a);
function Constructor() { this.x = 1; }
Constructor.prototype.y = 2;
for (let i = 0; i < 100; i++) { Constructor.count = i; new Constructor(); delete Constructor.count; }
console.log(Constructor.count, new Constructor().y, Object.getOwnPropertyNames(Constructor).join(), delete Constructor.prototype);
