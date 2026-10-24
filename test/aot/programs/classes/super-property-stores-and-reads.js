// super.x reads from the prototype of the home object with `this` as the receiver; super.x = v stores on `this`, past or through what the chain above the home object says.
function attempt(run) { try { return run(); } catch (error) { return error.constructor.name; } }
const log = [];
class Base {
  get viaGetter() { return "getter of " + this.tag; }
  set viaSetter(value) { log.push("setter " + this.tag + " " + value); }
  plain() { return "plain of " + this.tag; }
}
Base.prototype.data = "data of Base";
Object.defineProperty(Base.prototype, "readOnly", { value: "read only", writable: false, configurable: true });
class Derived extends Base {
  tag = "derived";
  read() { return [super.viaGetter, super.plain(), super.data, super.missing, super.readOnly].join(" | "); }
  store() { super.viaSetter = 1; super.data = "stored"; super.fresh = "fresh"; return [Object.keys(this).join(), Base.prototype.data, this.data, this.fresh].join(" | "); }
  storeReadOnly() { "use strict"; super.readOnly = 2; return this.readOnly; }
  storeOverOwnAccessor() { Object.defineProperty(this, "data", { get() { return "own getter"; }, set(value) { log.push("own setter " + value); }, configurable: true }); super.data = "x"; return this.data; }
  storeOverOwnReadOnly() { Object.defineProperty(this, "data", { value: "own fixed", writable: false, configurable: true }); super.data = "y"; return this.data; }
  computed(key) { return super[key]; }
  storeComputed(key, value) { super[key] = value; return this[key]; }
  remove() { return delete super.data; }
  arrow() { return (() => super.plain())(); }
  static make() { return super.name + " " + typeof super.call; }
}
const one = new Derived();
console.log(one.read());
console.log(one.store(), log.join());
console.log(attempt(() => one.storeReadOnly()), attempt(() => new Derived().storeOverOwnAccessor()), log.join(), attempt(() => new Derived().storeOverOwnReadOnly()));
console.log(one.computed("data"), one.computed("viaGetter"), one.storeComputed("k", 5), one.storeComputed(7, "seven"), attempt(() => one.remove()), one.arrow(), Derived.make());
// The home object decides, not the receiver: a method that is borrowed keeps its super.
const borrowed = { tag: "borrowed", read: Derived.prototype.read, store: Derived.prototype.store };
console.log(borrowed.read());
console.log(borrowed.store());
// The prototype of the home object is looked up at each access.
const other = { plain() { return "other plain of " + this.tag; }, data: "data of other", get viaGetter() { return "other getter"; } };
Object.setPrototypeOf(Derived.prototype, other);
console.log(one.read(), one.arrow());
Object.setPrototypeOf(Derived.prototype, null);
console.log(attempt(() => one.read()), attempt(() => one.storeComputed("z", 1)));
Object.setPrototypeOf(Derived.prototype, Base.prototype);
// In an object literal.
const parent = { hello() { return "parent hello " + this.name; }, set mark(value) { log.push("mark " + this.name + value); } };
const child = { __proto__: parent, name: "child", hello() { return "child > " + super.hello(); }, put() { super.mark = "!"; super.own = 1; return Object.keys(this).join(); } };
console.log(child.hello(), child.put(), log.at(-1), Object.create(child, { name: { value: "grandchild" } }).hello());
// The receiver is frozen, a primitive, a proxy.
console.log(attempt(() => Derived.prototype.storeComputed.call(Object.freeze({}), "a", 1)), attempt(() => Derived.prototype.storeComputed.call(5, "a", 1)), attempt(() => Derived.prototype.computed.call("text", "viaGetter")));
const seen = [];
const watched = new Proxy({}, { defineProperty(target, key, descriptor) { seen.push("define " + String(key)); return Reflect.defineProperty(target, key, descriptor); }, getOwnPropertyDescriptor(target, key) { seen.push("describe " + String(key)); return Reflect.getOwnPropertyDescriptor(target, key); }, set() { seen.push("set"); return true; } });
Derived.prototype.storeComputed.call(watched, "w", 1);
console.log(seen.join());
