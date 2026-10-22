// A base constructor stores under a name for which the class of new.target has an accessor or a read-only property. On such an instance the store creates nothing: the setter runs, or the store
// throws in strict code, and the instance never has the property. Instances of the base itself exist too and get the property. Each family has classes of its own, so that what one row reads
// or lists does not change what is known about another.
const log = [];

function Tagged(v) { this.tag = v; }
class Logged extends Tagged { set tag(v) { log.push("setter " + v); } }
new Logged(1); new Tagged(2);
console.log("function, nobody reads:", log.join());

class Valued { constructor(v) { this.value = v; } }
const Observable = Parent => class extends Parent {
  set value(v) { this.stored = v * 2; }
  get value() { return this.stored; }
};
const Watched = Observable(Valued);
const valued = new Valued(1);
const watched = new Watched(21);
console.log("mixin:", watched.value, watched.stored, Object.keys(watched).join(), valued instanceof Valued);

function Owned(v) { this.own = v; }
class NotOwned extends Owned { set own(v) { this.got = v; } }
const notOwned = new NotOwned(1), owned = new Owned(2);
console.log("own property:", Object.hasOwn(notOwned, "own"), Object.hasOwn(owned, "own"), "own" in notOwned, notOwned.own, owned.own, notOwned.got);

class Listed { constructor(v) { this.first = v; this.second = v + 1; } }
class Shorter extends Listed { set first(v) { this.third = v; } }
console.log("keys:", Object.keys(new Shorter(1)).join(), Object.keys(new Listed(2)).join(), JSON.stringify(new Shorter(3)), JSON.stringify(new Listed(4)));

function Fixed(v) { try { this.fixed = v; this.thrown = "nothing"; } catch (error) { this.thrown = error.name; } }
class GetterAlone extends Fixed { get fixed() { return "getter"; } }
class ReadOnly extends Fixed {}
Object.defineProperty(ReadOnly.prototype, "fixed", { value: "read-only", writable: false });
for (const made of [new GetterAlone(1), new ReadOnly(2), new Fixed(3)]) console.log("refused:", made.thrown, made.fixed, Object.keys(made).join());

class Deep { constructor(v) { this.deep = v; } }
class Middle extends Deep { set deep(v) { log.push("middle " + v); } }
class Lowest extends Middle {}
log.length = 0;
new Lowest(1); new Middle(2); new Deep(3);
console.log("two levels:", log.join());

class Later { constructor(v) { this.later = v; } }
class StoresAgain extends Later {
  constructor(v) { super(v); this.later = v + 1; }
  set later(v) { log.push("later " + v); }
}
log.length = 0;
new StoresAgain(1); new Later(5);
console.log("store after super:", log.join());

class Defined { constructor(v) { this.defined = v; } }
class DefinesOwn extends Defined {
  constructor(v) { super(v); Object.defineProperty(this, "defined", { value: "own", writable: true, enumerable: true, configurable: true }); this.defined = "stored"; }
  set defined(v) { log.push("defined " + v); }
}
log.length = 0;
const definesOwn = new DefinesOwn(1); new Defined(2);
console.log("own data over the setter:", log.join(), definesOwn.defined, Object.keys(definesOwn).join());

function Counted(v) { this.count = v; }
class Counting extends Counted { set count(v) { Counting.total += v; } }
Counting.total = 0;
let kept = 0;
for (let i = 0; i < 20000; i++) {
  new Counting(i & 3);
  kept += new Counted(i & 1).count;
}
console.log("in a loop:", Counting.total, kept);
