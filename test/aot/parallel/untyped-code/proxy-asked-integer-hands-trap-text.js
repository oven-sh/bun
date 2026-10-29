// proxy[5], proxy[5] = v, 5 in proxy and delete proxy[5] hand the trap the text "5". Without a trap the target is asked. Whatever the key is at one place of the program: an integer, one below zero, a large one, a number with a fraction, a text, a symbol, an object that is made a key by its own code.
const log = [];
const told = work => { try { return work(); } catch (error) { return error.constructor.name; } };
const shown = value => JSON.stringify(value, (key, held) => held === undefined ? "undefined" : typeof held === "function" ? "function" : typeof held === "symbol" ? String(held) : typeof held === "number" && !Number.isFinite(held) ? String(held) : Object.is(held, -0) ? "-0" : held);
function say(label, value) { console.log(label + ": " + shown(value) + (log.length ? " | " + log.splice(0).join(" ") : "")); }
const note = (trap, key) => log.push(trap + ":" + typeof key + ":" + String(key));
const handsOn = {
  get(target, key, receiver) { note("get", key); return Reflect.get(target, key, receiver); }, set(target, key, value, receiver) { note("set", key); return Reflect.set(target, key, value, receiver); },
  has(target, key) { note("has", key); return Reflect.has(target, key); }, deleteProperty(target, key) { note("delete", key); return Reflect.deleteProperty(target, key); },
};
const asksItself = { get(target, key) { return target[key]; }, set(target, key, value) { target[key] = value; return true; }, has(target, key) { return key in target; }, deleteProperty(target, key) { return delete target[key]; } };
const none = {};
const targets = () => ({
  "integers": [1, 2, 3], "fractions": [1.5, 2.5, 3.5], "anything": ["a", {}, null], "holes": [1, , 3], "empty": [], "frozen": Object.freeze([1, 2, 3]), "an object": { 0: "zero", 1: "one", "-1": "minus", 2147483647: "large" }, "bytes": new Uint8Array([7, 8, 9]),
  "a text": new String("abc"), "arguments": (function () { return arguments; })(4, 5, 6), "a getter": Object.defineProperty([1, 2, 3], 1, { get() { return "got by " + (Array.isArray(this) ? "a list" : typeof this); } }), "above": Object.setPrototypeOf([1], { 1: "inherited", get 2() { return "inherited getter"; } }), "sparse": (() => { const made = []; made[100000] = 1; made[1] = "one"; return made; })(),
});
const keys = () => [0, 1, 2, 3, -1, 2147483647, -2147483648, 100000, 1.5, NaN, -0, 4294967295, 4294967296, "1", "01", "-1", "length", Symbol.iterator, { toString() { log.push("made a key"); return "1"; } }, null, undefined, true, 2n];
function read(from, key) { return from[key]; }
function store(into, key, value) { into[key] = value; return into[key]; }
function test(inside, key) { return key in inside; }
function remove(from, key) { return delete from[key]; }
function readAtInteger(from, i) { return from[i | 0]; }
function sumOf(list) { let sum = 0; for (let i = 0; i < list.length; i++) sum += list[i]; return sum; }
for (let round = 0; round < 2; round++)
  for (const [nameOfHandler, handler] of [["hands on", handsOn], ["asks the target itself", asksItself], ["no trap", none]])
    for (const nameOfTarget of Object.keys(targets())) {
      const make = () => new Proxy(targets()[nameOfTarget], handler);
      say(nameOfHandler + " | " + nameOfTarget + " | read", keys().map(key => told(() => read(make(), key))));
      say(nameOfHandler + " | " + nameOfTarget + " | in", keys().map(key => told(() => test(make(), key))));
      say(nameOfHandler + " | " + nameOfTarget + " | store", keys().map(key => told(() => store(make(), key, 9))));
      say(nameOfHandler + " | " + nameOfTarget + " | delete", keys().map(key => told(() => remove(make(), key))));
      say(nameOfHandler + " | " + nameOfTarget + " | at integers", [0, 1, 2, 3, -1, 1.9, "1", 4294967297].map(key => told(() => readAtInteger(make(), key))));
    }
say("what the places do for what is no proxy", keys().map(key => told(() => [read([1, 2, 3], key), test([1, 2, 3], key), store([1, 2, 3], key, 9), remove([1, 2, 3], key), read("abc", key), read({ 1: "one" }, key)])));
say("a trap that answers by itself", [0, 1, 5].map(key => read(new Proxy([1, 2], { get(target, name) { return typeof name + name; } }), key)));
say("an answer against a fixed element", told(() => read(new Proxy(Object.freeze([1, 2]), { get() { return 9; } }), 1)));
say("revoked", told(() => { const made = Proxy.revocable([1], none); made.revoke(); return read(made.proxy, 0); }));
class Below { get 1() { return "a getter above for " + this.constructor.name; } set 2(value) { log.push("a setter above " + value); } }
class Queues extends Below {
  #lists = []; #asked = 0; static #made = 0;
  push(at, value) { this.#asked++; (this.#lists[at] ||= []).push(value); (this.#lists[at | 0] ??= []).push(value); this.#lists[at | 0].length += 0; return #lists in this; }
  above(at) { return [told(() => { super[at | 0] = at; return "stored"; }), super[at | 0], super[at], super[String(at)]]; }
  static count(at) { return { [at | 0]: ++Queues.#made, [at]: Queues.#made }; }
  get shown() { return [this.#lists, this.#asked]; }
}
say("keys that are made names once, beside private names and super", (() => { const queues = new Queues; return [[0, 2, 1, 2, "1", 1.5].map(at => queues.push(at, at)), queues.shown, [1, 2, 3].map(at => queues.above(at)), Queues.count(1), Queues.count("x")]; })());
const list = [1, 2, 3, 4, 5, 6, 7, 8], reactive = new Proxy(list, { get(target, key, receiver) { return Reflect.get(target, key, receiver); }, set(target, key, value, receiver) { return Reflect.set(target, key, value, receiver); }, has(target, key) { return Reflect.has(target, key); } }), bare = new Proxy(list, none);
let sum = 0;
for (let i = 0; i < 40000; i++) { sum += reactive[i & 7] + bare[(i + 1) & 7] + sumOf(reactive) + ((i & 15) in reactive ? 1 : 0) + ((i & 15) in bare ? 1 : 0); reactive[i & 7] = i & 3; bare[(i + 3) & 7] = i & 1; }
console.log(sum, list.join());
