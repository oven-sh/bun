// The class declares, with other kinds of values, names that the function of the library stores into the same object.
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
class Odd extends EventEmitter { _eventsCount = "many"; _maxListeners = 1; }
const odd = new Odd();
odd.on("a", () => {});
console.log(odd._eventsCount, odd._maxListeners, odd.getMaxListeners(), odd.listenerCount("a"), Object.keys(odd).join());
class Early extends EventEmitter { constructor() { super(); this._events = { __proto__: null, a: () => console.log("planted") }; } }
console.log(new Early().emit("a"), new Early().eventNames().join());
class Hidden extends Readable {
  _readableState = "mine";
  get own() { return this._readableState; }
}
const hidden = new Hidden();
console.log(hidden.own, typeof hidden._readableState);
try { console.log(hidden.readableFlowing); } catch (error) { console.log(error.constructor.name); }
class Accessor extends EventEmitter {
  get _events() { return this.kept; }
  set _events(value) { this.kept = value; this.stores = (this.stores ?? 0) + 1; }
}
const accessor = new Accessor();
accessor.on("x", () => {});
console.log(accessor.stores, accessor.listenerCount("x"), Object.keys(accessor).join());
