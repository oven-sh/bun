// `new Set()` without operands, with undefined and with null makes an empty set of the class itself: its prototype, its size, what it takes, what a class below Set makes, what Reflect.construct makes for another new.target, and a million of them across collections.
class Bag extends Set { extra = 1; }
function show(s) { return [Object.getPrototypeOf(s) === Set.prototype, s instanceof Set, Reflect.get(Set.prototype, "size", s), Object.prototype.toString.call(s), Object.keys(s).length, Object.isExtensible(s)].join(); }
function plain() { return new Set(); }
function withUndefined() { return new Set(undefined); }
function withNull() { return new Set(null); }
function filled() { const s = new Set(); s.add(1); s.add("a"); s.add(s); s.add(1); return s; }
function below() { return new Bag(); }
function forAnother() { return Reflect.construct(Set, [], Bag); }
function forObject() { return Reflect.construct(Set, [], Object); }
for (const make of [plain, withUndefined, withNull, filled, below, forAnother, forObject]) { let last; for (let i = 0; i < 2000; i++) last = make(); console.log(make.name, show(last), Set.prototype.has.call(last, 1), last.extra); }
let threw = ""; try { Set(); } catch (e) { threw = e.name; } console.log(threw);
const kept = []; let total = 0;
for (let i = 0; i < 1000000; i++) { const s = new Set(); if ((i & 1023) === 0) { s.add(i); kept.push(s); } total += s.size; }
console.log(total, kept.length, kept[5].has(5120), kept.every(s => s.size === 1));
const named = new Set(); named.label = "own"; named[0] = 1; console.log(named.label, named[0], named.size, JSON.stringify([...named]));
const frozen = Object.freeze(new Set()); frozen.add(1); console.log(frozen.size, Object.isFrozen(frozen));
console.log([...new Set().union(new Set([1]))].join(), new Set().isSubsetOf(new Set()), structuredClone(new Set()).size, new Set().entries().next().done);
