const EventEmitter = require("node:events");
const { Readable, Writable } = require("node:stream");
const say = (...words) => console.log(words.join(" "));
function tried(label, work) { try { say(label, work()); } catch (error) { say(label, "throws", error && error.constructor.name); } }
tried("an own accessor, events held", () => { const shared = {}; let reads = 0; const made = Object.create(EventEmitter.prototype); made._events = shared; Object.defineProperty(made, "__proto__", { configurable: true, get() { reads++; return { _events: shared }; } }); EventEmitter.call(made); return reads + " " + (made._events === shared); });
tried("an own accessor, no events", () => { let reads = 0; const made = Object.create(EventEmitter.prototype); Object.defineProperty(made, "__proto__", { configurable: true, get() { reads++; return {}; } }); EventEmitter.call(made); return reads + " " + typeof made._events; });
tried("an accessor that a class declares", () => { let reads = 0; const shared = {}; class Heir extends EventEmitter { constructor() { super(); } get __proto__() { reads++; return { _events: shared }; } } Heir.prototype._events = shared; const made = new Heir(); return reads + " " + (made._events === shared) + " " + Object.hasOwn(made, "_events"); });
tried("an own value that is nothing", () => { const made = Object.create(EventEmitter.prototype); made._events = {}; Object.defineProperty(made, "__proto__", { configurable: true, value: undefined }); EventEmitter.call(made); return "no throw"; });
tried("no prototype at all", () => { const made = Object.create(null); made._events = {}; EventEmitter.call(made); return "no throw"; });
tried("events on the prototype", () => { function Old() { EventEmitter.call(this); } Object.setPrototypeOf(Old.prototype, EventEmitter.prototype); Old.prototype._events = { kept: () => {} }; const made = new Old(); return Object.hasOwn(made, "_events") + " " + Object.keys(made._events).length; });
for (const [label, make] of [["Readable", () => new Readable({ read() {} })], ["Writable", () => new Writable({ write() {} })], ["an heir of Readable", () => new (class Heir extends Readable { get __proto__() { counted.reads++; return Readable.prototype; } })()]]) {
  var counted = { reads: 0 };
  tried(label, () => { const made = make(); return counted.reads + " " + typeof made._events + " " + made._eventsCount; });
}
