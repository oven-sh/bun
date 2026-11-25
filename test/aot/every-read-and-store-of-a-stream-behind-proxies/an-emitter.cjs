const EventEmitter = require("node:events");
const { Readable } = require("node:stream");
const { watch } = require("./watch.cjs");
const heard = (mark, word) => function () { mark(word + arguments.length); };
module.exports = [
  [
    ["made", async (log, what, mark) => { const made = Object.create(EventEmitter.prototype); made._events = {}; watch(made, log, what); EventEmitter.call(made); mark("again"); EventEmitter.call(made, { captureRejections: false }); }],
    ["nobody hears", async (log, what, mark) => { const e = new EventEmitter(); watch(e, log, what); e.emit("made"); mark("two"); e.emit("made", 1, 2); }],
    ["one hears", async (log, what, mark) => { const e = new EventEmitter(); e.on("made", heard(mark, "a")); watch(e, log, what); for (const list of [[], [1], [1, 2], [1, 2, 3], [1, 2, 3, 4]]) e.emit("made", ...list); }],
    ["three hear", async (log, what, mark) => { const e = new EventEmitter(); for (const word of "abc") e.on("made", heard(mark, word)); watch(e, log, what); for (const list of [[], [1], [1, 2], [1, 2, 3], [1, 2, 3, 4]]) e.emit("made", ...list); }],
    ["listeners come", async (log, what, mark) => { const e = new EventEmitter(); watch(e, log, what); for (const word of "abc") { mark(word); e.on("made", heard(mark, word)); } mark("in front"); e.prependListener("made", heard(mark, "d")); mark("once"); e.once("made", heard(mark, "e")); mark("emit"); e.emit("made"); mark("emit"); e.emit("made"); }],
    ["listeners go", async (log, what, mark) => { const e = new EventEmitter(); const all = [..."abcd"].map(word => heard(mark, word)); for (const f of all) e.on("made", f); watch(e, log, what); for (const at of [1, 3, 0, 2]) { mark("off " + at); e.removeListener("made", all[at]); } mark("none"); e.removeListener("made", all[0]); }],
    ["a listener goes amid the call", async (log, what, mark) => { const e = new EventEmitter(); const second = heard(mark, "b"); e.on("made", () => { mark("a"); e.off("made", second); }); e.on("made", second); e.on("made", heard(mark, "c")); watch(e, log, what); e.emit("made"); mark("again"); e.emit("made"); }],
    ["those who watch the listeners", async (log, what, mark) => { const e = new EventEmitter(); e.on("newListener", heard(mark, "new")); e.on("removeListener", heard(mark, "gone")); watch(e, log, what); const f = heard(mark, "a"); e.on("made", f); e.on("made", f); mark("off"); e.off("made", f); e.off("made", f); mark("all"); e.on("made", f); e.removeAllListeners("made"); e.removeAllListeners(); }],
    ["asked about its listeners", async (log, what, mark) => { const e = new EventEmitter(); const f = heard(mark, "a"); e.on("made", f); e.once("made", f); e.on("other", f); watch(e, log, what); e.listenerCount("made"); mark("with"); e.listenerCount("made", f); mark("list"); e.listeners("made"); mark("raw"); e.rawListeners("made"); mark("names"); e.eventNames(); mark("most"); e.getMaxListeners(); e.setMaxListeners(1); }],
    ["an error nobody hears", async (log, what, mark) => { const e = new EventEmitter(); watch(e, log, what); try { e.emit("error", new Error("made up")); } catch (error) { mark("threw " + error.message); } mark("heard"); e.on("error", heard(mark, "a")); e.emit("error", new Error("made up")); }],
    ["three hear a chunk", async (log, what, mark) => { const r = new Readable({ read() {} }); for (const word of "abc") r.on("data", heard(mark, word)); await new Promise(setImmediate); watch(r, log, what); r.push("ab"); mark("end"); for (const word of "ab") r.on("end", heard(mark, word)); r.push(null); }],
  ],
  ["e", "a", "p", "ap"],
];
