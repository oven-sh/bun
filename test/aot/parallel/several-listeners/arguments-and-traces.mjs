import { EventEmitter } from "node:events";
const out = [];
const show = v => typeof v === "string" ? JSON.stringify(v) : typeof v === "function" ? "function" : Array.isArray(v) ? "[" + v.map(show).join() + "]" : v instanceof Error ? v.name + ":" + v.message : v !== null && typeof v === "object" ? "{" + Object.keys(v).map(k => k + ":" + show(v[k])).join() + "}" : Object.is(v, -0) ? "-0" : String(v);
const log = (...vs) => out.push(vs.map(show).join(" "));
const list = JSON.parse('[3,1.5,"x",null,-2,true]');
const frames = error => error.name + ":" + String(error.stack).split("\n").slice(1).map(l => l.trim().replace(/^at /, "").replace(/ ?\(.*$/, "")).filter(l => /^[a-z]\w*$/i.test(l) && !/module|unknown|native/.test(l)).join("<");
const bus = new EventEmitter();
let turns = 0;
function counts(...args) { log("counts", args.length, args, this === bus); }
const arrow = (a, b, c) => log("arrow", a, b, c);
function strict() { "use strict"; log("strict", arguments.length, this === bus); return true; }
function traced(a) { log(frames(new Error("trace")), a); }
function removes() { if (turns++ & 1) bus.off("a", arrow); else if (turns < 40) bus.on("a", arrow); }
function thrown(a) { if (a === "x") throw new TypeError("listener"); }
for (const listener of [counts, arrow, strict, traced, removes, thrown]) bus.on("a", listener);
bus.once("a", counts);
bus.prependListener("b", counts);
bus.on("b", arrow);
bus.on("only", traced);
function emits() {
  for (let i = 0; i < list.length; i++) {
    const x = list[i];
    try {
      log(bus.emit("a"), bus.emit("a", x), bus.emit("a", x, i), bus.emit("a", x, i, 1), bus.emit("a", x, i, 1, 2), bus.emit("a", undefined), bus.emit("a", ...list));
    } catch (error) { log(frames(error)); }
    log(bus.emit("b", x, i), bus.emit("b"), bus.emit("only", x), bus.emit("only"), bus.emit("only", x, i, 1), bus.emit("none", x), bus.listenerCount("a"));
  }
}
emits();
class Heir extends EventEmitter { emit(type, ...args) { log("heir", type, args); return super.emit(type, ...args); } }
const heir = new Heir();
heir.on("a", arrow).on("a", function () { log(arguments.length, this === heir); });
for (let i = 0; i < 3; i++) log(heir.emit("a", i), heir.emit("a"), heir.emit("a", i, i, i));
// A list that a listener changes is walked as it was.
const changing = new EventEmitter();
let order = "";
const first = () => { order += "1"; changing.removeAllListeners("e"); };
const second = v => { order += "2" + v; };
for (let i = 0; i < 3; i++) { changing.on("e", first); changing.on("e", second); order += changing.emit("e", i) + " "; }
log(order);
const errors = new EventEmitter();
errors.on("error", e => log("one", e.message)); errors.on("error", (e, more) => log("two", e.message, more));
for (let i = 0; i < 3; i++) log(errors.emit("error", new Error("e" + i)), errors.emit("error", new Error("f" + i), i));
console.log(out.join("\n"));
