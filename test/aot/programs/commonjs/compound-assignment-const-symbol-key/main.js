// `o[k] ??= v` and its kin evaluate the key once: where the key's type is not known, an object is turned into a property key ahead of the read, and anything else goes on as it is: the two ways meet. Where every way yields the one symbol that a constant holds, the read and the store take the forms of names.
// IR= 0 socketOf ElemGet
// IR= 0 socketOf ElemSet
// IR= 0 orAssign ElemGet
// IR= 0 orAssign ElemSet
// IR= 0 andAssign ElemGet
// IR= 0 addAssign ElemGet
// IR= 0 addAssign ElemSet
// IR= 0 increment ElemGet
// IR= 0 increment ElemSet
// IR= 1 underOneOfTwo ElemGet
// IR= 1 underWhatIsGiven ElemGet
// IR= 1 underWhatALoopCarries ElemGet
"use strict";
const { kSocket, kCount, kOther } = require("./keys");
const lines = [];
function show(what, value) { lines.push(what + ": " + String(value)); }
function Made(owner) { this.owner = owner; }
function Holder() { this.n = 0; }
Object.defineProperty(Holder.prototype, "socket", { get: function socketOf() { return (this[kSocket] ??= new Made(this)); } });
Holder.prototype.orAssign = function orAssign() { return (this[kSocket] ||= new Made(this)); };
Holder.prototype.andAssign = function andAssign() { return (this[kSocket] &&= this.socket); };
Holder.prototype.addAssign = function addAssign() { this[kCount] = 1; this[kCount] += 2; return this[kCount]; };
Holder.prototype.increment = function increment() { this[kCount]++; return ++this[kCount]; };
Holder.prototype.underOneOfTwo = function underOneOfTwo(first) { const key = first ? kCount : kOther; return this[key]; };
Holder.prototype.underWhatIsGiven = function underWhatIsGiven(key) { return (this[key] ??= "given"); };
Holder.prototype.underWhatALoopCarries = function underWhatALoopCarries(turns) { let key = kCount, seen = 0; for (let i = 0; i < turns; i++) { seen = this[key]; key = i & 1 ? kCount : kOther; } return seen; };
let total = 0;
for (let i = 0; i < 300; i++) {
    const holder = new Holder();
    total += (holder.socket === holder.socket) + (holder.orAssign() === holder.socket) + (holder.andAssign() === holder.socket) + holder.addAssign() + holder.increment();
}
show("total", total);
const holder = new Holder();
holder[kOther] = "other";
show("symbols of a holder", [holder.socket instanceof Made, holder.addAssign(), holder.increment(), Object.getOwnPropertySymbols(holder).map(String).join()].join());
show("one of two", [holder.underOneOfTwo(true), holder.underOneOfTwo(false), holder.underWhatALoopCarries(1), holder.underWhatALoopCarries(2), holder.underWhatALoopCarries(3)].join());
let turned = 0;
const object = { toString() { turned++; return "written"; } };
show("an object as the key is turned into a key once", [holder.underWhatIsGiven(object), holder.underWhatIsGiven(object), turned, holder.written, holder.underWhatIsGiven(kOther), holder.underWhatIsGiven(7), holder[7]].join());
function outcome(run) { try { return String(run()); } catch (error) { return error instanceof TypeError ? "a TypeError" : String(error); } }
const socketOf = Object.getOwnPropertyDescriptor(Holder.prototype, "socket").get;
show("receivers that are no objects", [outcome(() => socketOf.call(null)), outcome(() => socketOf.call(undefined)), outcome(() => socketOf.call(5) instanceof Made), outcome(() => Holder.prototype.increment.call(undefined)), outcome(() => Holder.prototype.underWhatIsGiven.call(null, object)), turned].join());
const frozen = Object.freeze(new Holder());
show("a frozen receiver", [outcome(() => frozen.socket), outcome(() => frozen.addAssign())].join());
const watched = new Proxy(new Holder(), { get(target, key, receiver) { lines.push("get " + String(key)); return Reflect.get(target, key, receiver); }, set(target, key, value, receiver) { lines.push("set " + String(key)); return Reflect.set(target, key, value, receiver); } });
show("through a proxy", [socketOf.call(watched) instanceof Made, Holder.prototype.increment.call(watched)].join());
console.log(lines.join("\n"));
