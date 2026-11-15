// What stands below a built-in function finds the property that the function owns, and a store there is refused or goes through as that property says.
const log = console.log;
const attempt = (what, run) => {
  try { log(what, run()); } catch (error) { log(what, error.constructor.name); }
};
function sloppy(object, name, value) { object[name] = value; return Object.hasOwn(object, name); }
// The body of a class is strict.
class Strict {
  static store(object, name, value) { object[name] = value; return Object.hasOwn(object, name); }
  static assign(object, value) { object.call = value; return object.call === value; }
}
const strict = Strict.store;
const other = () => 1;

Object.defineProperty(WeakMap, "call", { value: WeakMap.call });
Object.defineProperty(WeakSet, "apply", { value: WeakSet.apply, writable: true, configurable: true });
class Fixed extends WeakMap {}
class Open extends WeakSet {}
class Own extends WeakMap { static call() { return 3; } }
attempt("sloppy, read-only", () => { Fixed.call = other; return Fixed.call === WeakMap.call; });
attempt("strict, read-only", () => Strict.assign(Fixed, other));
attempt("under a key, sloppy", () => sloppy(Fixed, "call", other));
attempt("under a key, strict", () => strict(Fixed, "call", other));
attempt("Reflect.set", () => Reflect.set(Fixed, "call", other));
log(Object.hasOwn(Fixed, "call"), Fixed.call === Function.prototype.call, Own.call(), Object.hasOwn(Own, "call"));
attempt("writable", () => { Open.apply = other; return Open.apply(); });
attempt("a name that nobody defined", () => { Fixed.bind = other; return Fixed.bind(); });
log(Object.hasOwn(Open, "apply"), WeakSet.apply === Function.prototype.apply, new Fixed() instanceof WeakMap, new Open() instanceof WeakSet);

// Objects that get a built-in function as their prototype.
Object.defineProperty(Math.trunc, "call", { value: Math.trunc.call });
Object.defineProperty(Math.trunc, "bind", { value: Math.trunc.bind, writable: true });
const made = Object.create(Math.trunc);
const given = Object.setPrototypeOf({ a: 1 }, Math.trunc);
const written = { __proto__: Math.trunc, b: 2 };
for (const object of [made, given, written]) {
  log(object.call === Function.prototype.call, "call" in object, Object.hasOwn(object, "call"));
  attempt("sloppy", () => sloppy(object, "call", other));
  attempt("strict", () => strict(object, "call", other));
  attempt("writable", () => strict(object, "bind", other));
  log(object.call === Function.prototype.call, object.bind === other, Object.keys(object).join());
}
written.call = 5;
log(written.call === Function.prototype.call);
class Records extends Map {}
for (let i = 0; i < 2000; ++i) {
  if (i === 1500) {
    class Late extends WeakMap { static { attempt("late", () => { this.call = other; return Object.hasOwn(this, "call"); }); } }
  }
}
Records.call = other;
log(Records.call(), Object.hasOwn(Map, "call"));
