"use strict";
// The order in which the constructors of streams read their options, the marks and modes that come out, and what Writable() takes for a Writable.
const { Readable, Writable, Duplex, Transform, PassThrough, setDefaultHighWaterMark, getDefaultHighWaterMark } = require("node:stream");
const say = (...parts) => console.log("#", ...parts);
const show = error => `${error.name} ${error.code} ${error.message}`;
const frames = error => String(error.stack).split("\n").filter(line => /^\s+at /.test(line)).slice(0, 3).map(line => line.trim().split(" ")[1]).join(" < ");
const classes = { Readable, Writable, Duplex, Transform, PassThrough };
const logged = (target, log) => new Proxy(target, { get(_, key) { log.push(String(key)); return target[key]; }, has(_, key) { log.push("has " + String(key)); return key in target; }, ownKeys() { log.push("keys"); return Reflect.ownKeys(target); }, getOwnPropertyDescriptor(_, key) { log.push("own " + String(key)); return Reflect.getOwnPropertyDescriptor(target, key); } });
function marks(stream) {
  const out = [];
  for (const name of ["_readableState", "_writableState"]) {
    const state = stream[name];
    out.push(state ? `${state.highWaterMark}/${state.objectMode}` : "-");
  }
  return out.join(" ");
}
function make(title, Class, options, log = []) {
  try { const stream = new Class(options); say(title, marks(stream), Object.keys(stream).join(), log.join()); return stream; }
  catch (error) { say(title, show(error), frames(error), log.join()); }
}
const values = [undefined, null, 0, 1, 7.9, -1, NaN, "3", "x", Infinity, 2 ** 40, true, {}, [], -0, 1n];
const text = value => typeof value === "bigint" ? value + "n" : Object.is(value, -0) ? "-0" : value === undefined ? "undefined" : JSON.stringify(value) ?? String(value);
for (const [name, Class] of Object.entries(classes)) {
  for (const key of ["highWaterMark", "readableHighWaterMark", "writableHighWaterMark"])
    for (const value of values) for (const mode of [{}, { objectMode: true }, { readableObjectMode: true }, { writableObjectMode: 1 }, { objectMode: 0 }]) make(`${name} ${key} ${text(value)} ${JSON.stringify(mode)}`, Class, { ...mode, [key]: value });
  for (const options of [undefined, null, {}, 0, "", "text", 5, true, [], () => {}, Object.create({ highWaterMark: 3, objectMode: true }), { highWaterMark: 5, readableHighWaterMark: 6, writableHighWaterMark: 7 }, { readableHighWaterMark: 6, writableHighWaterMark: 7 }]) make(`${name} ${typeof options} ${text(options)}`, Class, options);
  for (const options of [{}, { highWaterMark: 5 }, { highWaterMark: null }, { readableHighWaterMark: 2 }, { writableHighWaterMark: 2 }, { objectMode: true }, { highWaterMark: -1 }, { writableHighWaterMark: "no" }]) { const log = []; make(`${name} logged ${JSON.stringify(options)}`, Class, logged(options, log), log); }
}
let turns = 0;
for (const [name, Class] of Object.entries(classes)) make(name + " other at each read", Class, { get highWaterMark() { return ++turns % 2 ? null : 4; }, get readableHighWaterMark() { return ++turns; }, get writableHighWaterMark() { return ++turns; } });
setDefaultHighWaterMark(false, 11); setDefaultHighWaterMark(true, 12); say(getDefaultHighWaterMark(false), getDefaultHighWaterMark(true));
for (const [name, Class] of Object.entries(classes)) { make(name, Class, {}); make(name, Class, { objectMode: true }); make(name, Class); }
// A mode that a class below, an object or the prototype says.
for (const state of ["ReadableState", "WritableState"]) {
  const Owner = state[0] === "R" ? Readable : Writable, State = Owner[state];
  class Below extends State { get objectMode() { say("asked below"); return true; } set objectMode(value) { say("set below", value); } }
  Owner[state] = Below;
  for (const [name, Class] of Object.entries(classes)) make(`${name} with a ${state} below`, Class, {});
  Owner[state] = State;
  const before = Object.getOwnPropertyDescriptor(State.prototype, "objectMode");
  say(state, typeof before, before && Object.keys(before).join());
  try {
    Object.defineProperty(State.prototype, "objectMode", { configurable: true, get() { say("asked"); return "yes"; }, set(value) { say("set", value); } });
    for (const [name, Class] of Object.entries(classes)) make(`${name} over a changed ${state}`, Class, {});
    if (before) Object.defineProperty(State.prototype, "objectMode", before); else delete State.prototype.objectMode;
  } catch (error) { say(state, show(error)); }
  for (const [name, Class] of Object.entries(classes)) make(`${name} after`, Class, { objectMode: true });
  try { const bare = new State({ get highWaterMark() { Object.defineProperty(this, "highWaterMark", { value: undefined }); Object.defineProperty(State.prototype, "objectMode", { configurable: true, get: () => "late" }); return undefined; } }, undefined, true); say(bare.highWaterMark); } catch (error) { say(show(error)); }
  if (before) Object.defineProperty(State.prototype, "objectMode", before); else delete State.prototype.objectMode;
}
// What Writable() takes for an object of its own.
const traps = [];
const trapped = (target, title) => new Proxy(target, { getPrototypeOf(it) { traps.push(title); return Reflect.getPrototypeOf(it); }, get(it, key, receiver) { traps.push(title + "." + String(key)); return Reflect.get(it, key, receiver); } });
class Under extends Writable {}
class Own { constructor() { this._writableState = new Writable.WritableState({}, this, false); } }
const things = { undefined, null: null, number: 5, object: {}, bare: Object.create(null), under: Object.create(Under.prototype), made: Object.create(Writable.prototype), own: new Own(), ownDuplex: Object.create(Duplex.prototype), trapped: trapped({}, "trapped"), trappedWritable: trapped(Object.create(Writable.prototype), "below"), trappedOwn: trapped(new Own(), "own"), fake: { _writableState: {} }, falsy: { _writableState: 0 }, throws: { get _writableState() { throw new TypeError("no state"); } }, function: function () {}, frozen: Object.freeze(Object.create(Writable.prototype)) };
for (const [title, thing] of Object.entries(things)) {
  traps.length = 0;
  let answer; try { answer = thing instanceof Writable; } catch (error) { answer = show(error) + " " + frames(error); }
  const asked = traps.join(); traps.length = 0;
  let called; try { const out = Writable.call(thing, {}); called = out === undefined ? "filled" : out === thing ? "itself" : out instanceof Writable ? "a new one" : typeof out; } catch (error) { called = show(error) + " " + frames(error); }
  say("Writable()", title, answer, asked, "|", called, traps.slice(0, 12).join());
}
say(Object.getOwnPropertyDescriptor(Writable, Symbol.hasInstance).value.name, JSON.stringify(Object.getOwnPropertyDescriptor(Writable, Symbol.hasInstance)), (() => { try { Object.defineProperty(Writable, Symbol.hasInstance, { value: () => true }); return "changed"; } catch (error) { return show(error); } })());
say(Writable({}) instanceof Writable, Writable() instanceof Writable, new Under() instanceof Writable, new Duplex() instanceof Writable, {} instanceof Under);
const prototype = Writable.prototype;
try { Writable.prototype = Object.create(prototype); say("prototype", Object.create(prototype) instanceof Writable, new Under() instanceof Writable, marks(new Under()), new Writable() instanceof Writable); } catch (error) { say(show(error)); }
Writable.prototype = prototype;
say("end", new Under() instanceof Writable, marks(new Writable({ write() {} })));
