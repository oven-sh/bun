// Public fields are defined, not stored: on whatever super() hands back, past setters, over accessors, and they throw where the object refuses.
function attempt(run) { try { return run(); } catch (error) { return error.constructor.name; } }
const log = [];
class Hand { constructor(object) { return object; } }
class Fields extends Hand { first = log.push("first") && 1; second = log.push("second") && 2; ["comp" + "uted"] = 3; 0 = "zero"; length = "length"; }
const withSetter = { set first(value) { log.push("setter ran"); }, get second() { return "getter"; } };
console.log(attempt(() => JSON.stringify(new Fields(withSetter))), JSON.stringify(Object.getOwnPropertyDescriptor(withSetter, "first")), log.join());
log.length = 0;
console.log(attempt(() => JSON.stringify(new Fields([9, 8, 7]))), log.join());
log.length = 0;
const callable = function f(a, b) {};
console.log(attempt(() => new Fields(callable).length), callable.first, callable[0], log.join());
log.length = 0;
const fixed = Object.defineProperty({}, "second", { value: "fixed", configurable: false, writable: false });
console.log(attempt(() => new Fields(fixed)), JSON.stringify(fixed), fixed.second, log.join());
log.length = 0;
const traps = [];
const proxy = new Proxy({}, { defineProperty(target, key, descriptor) { traps.push(String(key) + "=" + descriptor.value + (descriptor.writable && descriptor.enumerable && descriptor.configurable ? "" : "?")); return Reflect.defineProperty(target, key, descriptor); }, set() { traps.push("set"); return true; } });
new Fields(proxy);
console.log(traps.join(), JSON.stringify(proxy));
const refusing = new Proxy({}, { defineProperty(target, key) { return key !== "second"; } });
console.log(attempt(() => new Fields(refusing)), log.join());
log.length = 0;
console.log(attempt(() => new Fields(new Uint8Array(2))[0]), attempt(() => new Fields("text".split(""))), attempt(() => Object.keys(new Fields(Object("ab"))).join()));
// The same object goes through twice: a definition over a field that is there is fine.
const again = {};
new Fields(again); again.first = "changed"; new Fields(again);
console.log(JSON.stringify(again));
// The prototype of what is handed back is not that of the class.
console.log(new Fields({}) instanceof Fields, Object.getPrototypeOf(new Fields({})) === Object.prototype, new Fields(Object.create(Fields.prototype)) instanceof Fields);
