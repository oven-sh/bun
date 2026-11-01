// What a definition reads, converts and calls, in order: the key, the members of the descriptor, the traps of proxies.
"use strict";
const log = [];
const key = name => ({ toString() { log.push("key " + name); return name; } });
const watched = members => new Proxy(members, {
  has(t, k) { log.push("has " + String(k)); return k in t; },
  get(t, k) { log.push("get " + String(k)); return t[k]; },
  ownKeys(t) { log.push("ownKeys"); return Reflect.ownKeys(t); },
  getOwnPropertyDescriptor(t, k) { log.push("describe " + String(k)); return Reflect.getOwnPropertyDescriptor(t, k); },
});
const withGetters = () => ({
  get value() { log.push("read value"); return 1; },
  get writable() { log.push("read writable"); return true; },
  get enumerable() { log.push("read enumerable"); return 0; },
  get configurable() { log.push("read configurable"); return "x"; },
});
class Point { constructor() { this.x = 1; } }
const flush = label => { console.log(label, log.join(", ")); log.length = 0; };
for (let turn = 0; turn < 4; turn++) {
  for (const make of [() => ({ a: 1 }), () => new Point(), () => Object.create(null)]) {
    let o = make();
    Object.defineProperty(o, key("n"), withGetters()); flush("getters");
    Object.defineProperty(o, key("a"), watched({ value: 2, enumerable: true })); flush("proxy");
    Reflect.defineProperty(o, key("x"), watched({ get() { return 3; } })); flush("reflect");
    Object.defineProperties(o, watched({ one: watched({ value: 1 }), two: withGetters(), [Symbol.for("three")]: { value: 3 } })); flush("several");
    try { Object.defineProperty(o, key("bad"), { get value() { log.push("read value"); return 1; }, get get() { log.push("read get"); return () => 1; } }); } catch (e) { log.push(e.constructor.name); } flush("both");
    try { Object.defineProperty(o, key("bad"), { get: 5 }); } catch (e) { log.push(e.constructor.name + " " + e.message); } flush("no function");
    try { Object.defineProperty(o, key("bad"), 5); } catch (e) { log.push(e.constructor.name + " " + e.message); } flush("no object");
    try { Object.defineProperty(5, key("bad"), {}); } catch (e) { log.push(e.constructor.name + " " + e.message); } flush("no target");
    try { Reflect.defineProperty(5, key("bad"), {}); } catch (e) { log.push(e.constructor.name + " " + e.message); } flush("no target for Reflect");
    try { Object.defineProperties(o, { first: { value: 1, enumerable: true }, second: { get: 5 }, third: { value: 3 } }); } catch (e) { log.push(e.constructor.name); } flush("second is bad");
    try { Object.defineProperties(Object.freeze(make()), { first: { value: 1 }, second: { value: 2 } }); } catch (e) { log.push(e.constructor.name + " " + e.message); } flush("frozen");
    o = make(); Object.defineProperty(o, "fixed", { value: 1 });
    try { Object.defineProperties(o, { before: { value: 1, enumerable: true }, fixed: { value: 2 }, after: { value: 3 } }); } catch (e) { log.push(e.constructor.name + " " + e.message); } flush("halfway");
    console.log(Reflect.ownKeys(o).map(String).join());
  }
}
