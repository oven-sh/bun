// The getters on the prototype object of a database read private fields. Each is found under a key that is a value and is entered with a receiver that is no database: it throws a TypeError, as in plain Bun.
// Flags: --aot-validate
const http = require("node:http");
const lines = [];
const box = JSON.parse('{"held":null}');
function show(value) {
  if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  return typeof value;
}
function keyOn(object, description) {
  for (let level = object; level !== null && level !== Object.prototype; level = Object.getPrototypeOf(level)) {
    for (const key of Reflect.ownKeys(level)) if ((typeof key === "symbol" ? key.description : key) === description) return key;
  }
}
function holderOf(object, key) {
  let level = object;
  while (!Object.hasOwn(level, key)) level = Object.getPrototypeOf(level);
  return level;
}
function take(label, step, o) {
  let saw;
  try { saw = step(o); } catch (error) { saw = "throws " + error?.name; }
  lines.push(label + ": " + saw);
}
function useMessage(o) {
  for (const [name, use] of [["getHeaders", () => show(o.getHeaders())], ["hasHeader", () => o.hasHeader("x-one") + " " + o.hasHeader("x-two")], ["getHeaderNames", () => show(o.getHeaderNames())], ["setHeader", () => (o.setHeader("X-Three", "3"), show(o.getHeaders()))], ["removeHeader", () => (o.removeHeader("X-Three"), show(o.getHeaders()))]]) {
    if (typeof o?.[name] !== "function") continue;
    try { lines.push("  " + name + ": " + use()); } catch (error) { lines.push("  " + name + " throws " + error?.name); }
  }
}
const steps = [
["Bun.Database.cache.count, read on an heir", o => { const K = keyOn(o, "Bun.Database.cache.count"); return show(Object.create(o)[K]); }],
["Bun.Database.cache.count, read on an heir of an heir", o => { const K = keyOn(o, "Bun.Database.cache.count"); return show(Object.create(Object.create(o))[K]); }],
["Bun.Database.cache.count, read on the prototype object", o => { const K = keyOn(o, "Bun.Database.cache.count"); return show(holderOf(o, K)[K]); }],
["Bun.Database.cache.count, read on a proxy", o => { const K = keyOn(o, "Bun.Database.cache.count"); return show(new Proxy(o, {})[K]); }],
["Bun.Database.cache.count, taken by a pattern from an heir", o => { const K = keyOn(o, "Bun.Database.cache.count"); return show((({ [K]: found }) => found)(Object.create(o))); }],
["Bun.Database.cache.count, read on the prototype object out of a box", o => { const K = keyOn(o, "Bun.Database.cache.count"); return show((box.held = holderOf(o, K), box.held[K])); }],
["Bun.Database.cache.count, read on an heir out of a box", o => { const K = keyOn(o, "Bun.Database.cache.count"); return show((box.held = Object.create(o), box.held[K])); }],
["Bun.Database.cache.count, Reflect.get for an heir", o => { const K = keyOn(o, "Bun.Database.cache.count"); return show(Reflect.get(o, K, Object.create(o))); }],
["Bun.Database.cache.count, Reflect.get for a plain object", o => { const K = keyOn(o, "Bun.Database.cache.count"); return show(Reflect.get(o, K, {})); }],
["Bun.Database.cache.count, Reflect.get for a number", o => { const K = keyOn(o, "Bun.Database.cache.count"); return show(Reflect.get(o, K, 7)); }],
["Bun.Database.cache.count, Reflect.get for an emitter", o => { const K = keyOn(o, "Bun.Database.cache.count"); return show(Reflect.get(o, K, new (require("node:events").EventEmitter)())); }],
["Bun.Database.cache.count, the getter called on a plain object", o => { const K = keyOn(o, "Bun.Database.cache.count"); return show(Object.getOwnPropertyDescriptor(holderOf(o, K), K).get.call({})); }],
["Bun.Database.cache.count, the getter bound to an heir", o => { const K = keyOn(o, "Bun.Database.cache.count"); return show(Object.getOwnPropertyDescriptor(holderOf(o, K), K).get.bind(Object.create(o))()); }],
["Bun.Database.cache.count, the getter applied to undefined", o => { const K = keyOn(o, "Bun.Database.cache.count"); return show(Reflect.apply(Reflect.getOwnPropertyDescriptor(holderOf(o, K), K).get, undefined, [])); }],
["Bun.Database.cache.count, __lookupGetter__ called on an heir", o => { const K = keyOn(o, "Bun.Database.cache.count"); return show(o.__lookupGetter__(K).call(Object.create(o))); }],
["Bun.Database.cache.count, read on the database", o => { const K = keyOn(o, "Bun.Database.cache.count"); return show(typeof o[K]); }],
["handle, read on an heir", o => { const K = keyOn(o, "handle"); return show(Object.create(o)[K]); }],
["handle, read on an heir of an heir", o => { const K = keyOn(o, "handle"); return show(Object.create(Object.create(o))[K]); }],
["handle, read on the prototype object", o => { const K = keyOn(o, "handle"); return show(holderOf(o, K)[K]); }],
["handle, read on a proxy", o => { const K = keyOn(o, "handle"); return show(new Proxy(o, {})[K]); }],
["handle, taken by a pattern from an heir", o => { const K = keyOn(o, "handle"); return show((({ [K]: found }) => found)(Object.create(o))); }],
["handle, read on the prototype object out of a box", o => { const K = keyOn(o, "handle"); return show((box.held = holderOf(o, K), box.held[K])); }],
["handle, read on an heir out of a box", o => { const K = keyOn(o, "handle"); return show((box.held = Object.create(o), box.held[K])); }],
["handle, Reflect.get for an heir", o => { const K = keyOn(o, "handle"); return show(Reflect.get(o, K, Object.create(o))); }],
["handle, Reflect.get for a plain object", o => { const K = keyOn(o, "handle"); return show(Reflect.get(o, K, {})); }],
["handle, Reflect.get for a number", o => { const K = keyOn(o, "handle"); return show(Reflect.get(o, K, 7)); }],
["handle, Reflect.get for an emitter", o => { const K = keyOn(o, "handle"); return show(Reflect.get(o, K, new (require("node:events").EventEmitter)())); }],
["handle, the getter called on a plain object", o => { const K = keyOn(o, "handle"); return show(Object.getOwnPropertyDescriptor(holderOf(o, K), K).get.call({})); }],
["handle, the getter bound to an heir", o => { const K = keyOn(o, "handle"); return show(Object.getOwnPropertyDescriptor(holderOf(o, K), K).get.bind(Object.create(o))()); }],
["handle, the getter applied to undefined", o => { const K = keyOn(o, "handle"); return show(Reflect.apply(Reflect.getOwnPropertyDescriptor(holderOf(o, K), K).get, undefined, [])); }],
["handle, __lookupGetter__ called on an heir", o => { const K = keyOn(o, "handle"); return show(o.__lookupGetter__(K).call(Object.create(o))); }],
["handle, read on the database", o => { const K = keyOn(o, "handle"); return show(typeof o[K]); }],
["inTransaction, read on an heir", o => { const K = keyOn(o, "inTransaction"); return show(Object.create(o)[K]); }],
["inTransaction, read on an heir of an heir", o => { const K = keyOn(o, "inTransaction"); return show(Object.create(Object.create(o))[K]); }],
["inTransaction, read on the prototype object", o => { const K = keyOn(o, "inTransaction"); return show(holderOf(o, K)[K]); }],
["inTransaction, read on a proxy", o => { const K = keyOn(o, "inTransaction"); return show(new Proxy(o, {})[K]); }],
["inTransaction, taken by a pattern from an heir", o => { const K = keyOn(o, "inTransaction"); return show((({ [K]: found }) => found)(Object.create(o))); }],
["inTransaction, read on the prototype object out of a box", o => { const K = keyOn(o, "inTransaction"); return show((box.held = holderOf(o, K), box.held[K])); }],
["inTransaction, read on an heir out of a box", o => { const K = keyOn(o, "inTransaction"); return show((box.held = Object.create(o), box.held[K])); }],
["inTransaction, Reflect.get for an heir", o => { const K = keyOn(o, "inTransaction"); return show(Reflect.get(o, K, Object.create(o))); }],
["inTransaction, Reflect.get for a plain object", o => { const K = keyOn(o, "inTransaction"); return show(Reflect.get(o, K, {})); }],
["inTransaction, Reflect.get for a number", o => { const K = keyOn(o, "inTransaction"); return show(Reflect.get(o, K, 7)); }],
["inTransaction, Reflect.get for an emitter", o => { const K = keyOn(o, "inTransaction"); return show(Reflect.get(o, K, new (require("node:events").EventEmitter)())); }],
["inTransaction, the getter called on a plain object", o => { const K = keyOn(o, "inTransaction"); return show(Object.getOwnPropertyDescriptor(holderOf(o, K), K).get.call({})); }],
["inTransaction, the getter bound to an heir", o => { const K = keyOn(o, "inTransaction"); return show(Object.getOwnPropertyDescriptor(holderOf(o, K), K).get.bind(Object.create(o))()); }],
["inTransaction, the getter applied to undefined", o => { const K = keyOn(o, "inTransaction"); return show(Reflect.apply(Reflect.getOwnPropertyDescriptor(holderOf(o, K), K).get, undefined, [])); }],
["inTransaction, __lookupGetter__ called on an heir", o => { const K = keyOn(o, "inTransaction"); return show(o.__lookupGetter__(K).call(Object.create(o))); }],
["inTransaction, read on the database", o => { const K = keyOn(o, "inTransaction"); return show(typeof o[K]); }],
["onInsert, read on an heir", o => { const K = keyOn(o, "onInsert"); return show(Object.create(o)[K]); }],
["onInsert, read on an heir of an heir", o => { const K = keyOn(o, "onInsert"); return show(Object.create(Object.create(o))[K]); }],
["onInsert, read on the prototype object", o => { const K = keyOn(o, "onInsert"); return show(holderOf(o, K)[K]); }],
["onInsert, read on a proxy", o => { const K = keyOn(o, "onInsert"); return show(new Proxy(o, {})[K]); }],
["onInsert, taken by a pattern from an heir", o => { const K = keyOn(o, "onInsert"); return show((({ [K]: found }) => found)(Object.create(o))); }],
["onInsert, read on the prototype object out of a box", o => { const K = keyOn(o, "onInsert"); return show((box.held = holderOf(o, K), box.held[K])); }],
["onInsert, read on an heir out of a box", o => { const K = keyOn(o, "onInsert"); return show((box.held = Object.create(o), box.held[K])); }],
["onInsert, Reflect.get for an heir", o => { const K = keyOn(o, "onInsert"); return show(Reflect.get(o, K, Object.create(o))); }],
["onInsert, Reflect.get for a plain object", o => { const K = keyOn(o, "onInsert"); return show(Reflect.get(o, K, {})); }],
["onInsert, Reflect.get for a number", o => { const K = keyOn(o, "onInsert"); return show(Reflect.get(o, K, 7)); }],
["onInsert, Reflect.get for an emitter", o => { const K = keyOn(o, "onInsert"); return show(Reflect.get(o, K, new (require("node:events").EventEmitter)())); }],
["onInsert, the getter called on a plain object", o => { const K = keyOn(o, "onInsert"); return show(Object.getOwnPropertyDescriptor(holderOf(o, K), K).get.call({})); }],
["onInsert, the getter bound to an heir", o => { const K = keyOn(o, "onInsert"); return show(Object.getOwnPropertyDescriptor(holderOf(o, K), K).get.bind(Object.create(o))()); }],
["onInsert, the getter applied to undefined", o => { const K = keyOn(o, "onInsert"); return show(Reflect.apply(Reflect.getOwnPropertyDescriptor(holderOf(o, K), K).get, undefined, [])); }],
["onInsert, __lookupGetter__ called on an heir", o => { const K = keyOn(o, "onInsert"); return show(o.__lookupGetter__(K).call(Object.create(o))); }],
["onInsert, read on the database", o => { const K = keyOn(o, "onInsert"); return show(typeof o[K]); }],
];
for (const [label, step] of steps) {
  const o = new (require("bun:sqlite").Database)(":memory:");
  take(label, step, o);
  useMessage(o);
  o.close();
}
console.log(lines.join("\n"));
