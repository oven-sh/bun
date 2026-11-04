import { Readable, Writable, Duplex, Transform, PassThrough, Stream } from "node:stream";
import { EventEmitter } from "node:events";
const report = value => console.log(typeof value === "string" ? value : String(value));
// Generated: classes that share a prototype object, a kind of cell or a row of classes, each asked about the values of all.
const show = (value) => value === true ? "1" : value === false ? "0" : String(value);
function attempt(act) { try { return act(); } catch (error) { return "T"; } }
function maybe(name, make, values) { try { values.push([name, make()]); } catch (error) { values.push([name + ", which cannot be made: " + error.name, undefined]); } }

function isStream(x) { return x instanceof Stream; }
function countStream(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Stream) count++; } return count; }
function isReadable(x) { return x instanceof Readable; }
function countReadable(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Readable) count++; } return count; }
function isWritable(x) { return x instanceof Writable; }
function countWritable(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Writable) count++; } return count; }
function isDuplex(x) { return x instanceof Duplex; }
function countDuplex(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Duplex) count++; } return count; }
function isTransform(x) { return x instanceof Transform; }
function countTransform(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Transform) count++; } return count; }
function isPassThrough(x) { return x instanceof PassThrough; }
function countPassThrough(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof PassThrough) count++; } return count; }
function isEventEmitter(x) { return x instanceof EventEmitter; }
function countEventEmitter(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof EventEmitter) count++; } return count; }
const tests = [["Stream", isStream, countStream], ["Readable", isReadable, countReadable], ["Writable", isWritable, countWritable], ["Duplex", isDuplex, countDuplex], ["Transform", isTransform, countTransform], ["PassThrough", isPassThrough, countPassThrough], ["EventEmitter", isEventEmitter, countEventEmitter]];
const values = [];
maybe("created below Stream.prototype", () => Object.create(Stream.prototype), values);
maybe("Stream.prototype", () => Stream.prototype, values);
maybe("Stream", () => Stream, values);
maybe("new Stream", () => new Stream(), values);
maybe("new of a class below Stream", () => new (class extends Stream {})(), values);
maybe("new Stream without its prototype", () => Object.setPrototypeOf(new Stream(), null), values);
maybe("new Stream below Readable.prototype", () => Object.setPrototypeOf(new Stream(), Readable.prototype), values);
maybe("a proxy of new Stream", () => new Proxy(new Stream(), {}), values);
maybe("Stream made for Readable as new.target", () => Reflect.construct(Stream, [], Readable), values);
maybe("created below Readable.prototype", () => Object.create(Readable.prototype), values);
maybe("Readable.prototype", () => Readable.prototype, values);
maybe("Readable", () => Readable, values);
maybe("new Readable", () => new Readable({ read() {} }), values);
maybe("new of a class below Readable", () => new (class extends Readable {})({ read() {} }), values);
maybe("new Readable without its prototype", () => Object.setPrototypeOf(new Readable({ read() {} }), null), values);
maybe("new Readable below Writable.prototype", () => Object.setPrototypeOf(new Readable({ read() {} }), Writable.prototype), values);
maybe("a proxy of new Readable", () => new Proxy(new Readable({ read() {} }), {}), values);
maybe("Readable made for Writable as new.target", () => Reflect.construct(Readable, [{ read() {} }], Writable), values);
maybe("created below Writable.prototype", () => Object.create(Writable.prototype), values);
maybe("Writable.prototype", () => Writable.prototype, values);
maybe("Writable", () => Writable, values);
maybe("new Writable", () => new Writable({ write() {} }), values);
maybe("new of a class below Writable", () => new (class extends Writable {})({ write() {} }), values);
maybe("new Writable without its prototype", () => Object.setPrototypeOf(new Writable({ write() {} }), null), values);
maybe("new Writable below Duplex.prototype", () => Object.setPrototypeOf(new Writable({ write() {} }), Duplex.prototype), values);
maybe("a proxy of new Writable", () => new Proxy(new Writable({ write() {} }), {}), values);
maybe("Writable made for Duplex as new.target", () => Reflect.construct(Writable, [{ write() {} }], Duplex), values);
maybe("created below Duplex.prototype", () => Object.create(Duplex.prototype), values);
maybe("Duplex.prototype", () => Duplex.prototype, values);
maybe("Duplex", () => Duplex, values);
maybe("new Duplex", () => new Duplex({ read() {}, write() {} }), values);
maybe("new of a class below Duplex", () => new (class extends Duplex {})({ read() {}, write() {} }), values);
maybe("new Duplex without its prototype", () => Object.setPrototypeOf(new Duplex({ read() {}, write() {} }), null), values);
maybe("new Duplex below Transform.prototype", () => Object.setPrototypeOf(new Duplex({ read() {}, write() {} }), Transform.prototype), values);
maybe("a proxy of new Duplex", () => new Proxy(new Duplex({ read() {}, write() {} }), {}), values);
maybe("Duplex made for Transform as new.target", () => Reflect.construct(Duplex, [{ read() {}, write() {} }], Transform), values);
maybe("created below Transform.prototype", () => Object.create(Transform.prototype), values);
maybe("Transform.prototype", () => Transform.prototype, values);
maybe("Transform", () => Transform, values);
maybe("new Transform", () => new Transform(), values);
maybe("new of a class below Transform", () => new (class extends Transform {})(), values);
maybe("new Transform without its prototype", () => Object.setPrototypeOf(new Transform(), null), values);
maybe("new Transform below PassThrough.prototype", () => Object.setPrototypeOf(new Transform(), PassThrough.prototype), values);
maybe("a proxy of new Transform", () => new Proxy(new Transform(), {}), values);
maybe("Transform made for PassThrough as new.target", () => Reflect.construct(Transform, [], PassThrough), values);
maybe("created below PassThrough.prototype", () => Object.create(PassThrough.prototype), values);
maybe("PassThrough.prototype", () => PassThrough.prototype, values);
maybe("PassThrough", () => PassThrough, values);
maybe("new PassThrough", () => new PassThrough(), values);
maybe("new of a class below PassThrough", () => new (class extends PassThrough {})(), values);
maybe("new PassThrough without its prototype", () => Object.setPrototypeOf(new PassThrough(), null), values);
maybe("new PassThrough below EventEmitter.prototype", () => Object.setPrototypeOf(new PassThrough(), EventEmitter.prototype), values);
maybe("a proxy of new PassThrough", () => new Proxy(new PassThrough(), {}), values);
maybe("PassThrough made for EventEmitter as new.target", () => Reflect.construct(PassThrough, [], EventEmitter), values);
maybe("created below EventEmitter.prototype", () => Object.create(EventEmitter.prototype), values);
maybe("EventEmitter.prototype", () => EventEmitter.prototype, values);
maybe("EventEmitter", () => EventEmitter, values);
maybe("new EventEmitter", () => new EventEmitter(), values);
maybe("new of a class below EventEmitter", () => new (class extends EventEmitter {})(), values);
maybe("new EventEmitter without its prototype", () => Object.setPrototypeOf(new EventEmitter(), null), values);
maybe("new EventEmitter below Stream.prototype", () => Object.setPrototypeOf(new EventEmitter(), Stream.prototype), values);
maybe("a proxy of new EventEmitter", () => new Proxy(new EventEmitter(), {}), values);
maybe("EventEmitter made for Stream as new.target", () => Reflect.construct(EventEmitter, [], Stream), values);
maybe("process.stdout", () => (process.stdout), values);
maybe("process.stdin", () => (process.stdin), values);
maybe("process", () => (process), values);
maybe("Readable.from([])", () => (Readable.from([])), values);
maybe("({ _writableState: {} })", () => (({ _writableState: {} })), values);
maybe("Object.assign(Object.create(Readable.prototype), { _writableState: {} })", () => (Object.assign(Object.create(Readable.prototype), { _writableState: {} })), values);
for (const [name, value] of values) {
  let answers = "";
  for (const [, is, count] of tests) answers += show(attempt(() => is(value))) + show(attempt(() => count(value)));
  report(answers + " " + name);
}
const ordinary = Function.prototype[Symbol.hasInstance];
report("Stream: " + (Stream[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Stream, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Stream, value))) + show(attempt(() => Stream[Symbol.hasInstance](value)))).join(""));
report("Readable: " + (Readable[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Readable, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Readable, value))) + show(attempt(() => Readable[Symbol.hasInstance](value)))).join(""));
report("Writable: " + (Writable[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Writable, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Writable, value))) + show(attempt(() => Writable[Symbol.hasInstance](value)))).join(""));
report("Duplex: " + (Duplex[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Duplex, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Duplex, value))) + show(attempt(() => Duplex[Symbol.hasInstance](value)))).join(""));
report("Transform: " + (Transform[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Transform, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Transform, value))) + show(attempt(() => Transform[Symbol.hasInstance](value)))).join(""));
report("PassThrough: " + (PassThrough[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(PassThrough, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(PassThrough, value))) + show(attempt(() => PassThrough[Symbol.hasInstance](value)))).join(""));
report("EventEmitter: " + (EventEmitter[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(EventEmitter, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(EventEmitter, value))) + show(attempt(() => EventEmitter[Symbol.hasInstance](value)))).join(""));
process.exit(0);
