// What a constructor stores on `this` under a symbol is a field of its layout, whoever constructs. ONE DEED: in sloppy code a store that a read-only value above refuses is dropped, and `this` of a plain call is the global object.
const { kA } = { kA: Symbol("a") };
function Thing(a) { this.first = a; this[kA] = a; }
globalThis.holder = { Thing, key: kA };
const show = (o) => Reflect.ownKeys(o).map(String).join() + " | " + String(o[kA]);
console.log(show(new globalThis.holder.Thing(1)));
Object.defineProperty(Thing.prototype, globalThis.holder.key, { value: "fixed", writable: false, configurable: true });
console.log(show(new globalThis.holder.Thing(2)));
delete Thing.prototype[kA];
globalThis.holder.Thing(3);
console.log(globalThis.first, globalThis[kA], show(new globalThis.holder.Thing(4)));
