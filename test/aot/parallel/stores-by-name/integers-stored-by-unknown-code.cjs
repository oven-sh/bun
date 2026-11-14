// Integers stored by code that does not know the object, into fields that hold integers, texts, objects or anything, beside every other kind.
"use strict";
class Task { constructor(id) { this.id = id; this.rank = 0; this.owner = null; this.note = "n"; this.any = undefined; this.state = -1; } }
class Step extends Task { constructor(id) { super(id); this.depth = 1; this.parent = null; } }
class Plain { constructor() { this.rank = "low"; this.state = null; this.owner = 7; } }
const setters = {
  rank(o, v) { o.rank = v; }, owner(o, v) { o.owner = v; }, note(o, v) { o.note = v; }, any(o, v) { o.any = v; }, state(o, v) { o.state = v; }, depth(o, v) { o.depth = v; }, parent(o, v) { o.parent = v; },
};
const kinds = [1, 0, -1, 2147483647, -2147483648, 0.5, -0, NaN, 2147483648, "s", "", null, undefined, true, false, Symbol.iterator, 10n, {}, [], () => 1];
const show = (v) => typeof v === "function" ? "f" : Array.isArray(v) ? "[]" : v && typeof v === "object" ? "{}" : Object.is(v, -0) ? "-0" : typeof v + " " + String(v);
const digest = (o) => Object.keys(o).map((k) => k + "=" + show(o[k])).join();
const make = (k) => [new Task(k), new Step(k), new Plain(), { rank: k, state: "open" }, Object.freeze(new Task(k)), Object.seal(new Step(k)), Object.preventExtensions(new Plain()), Object.defineProperty(new Task(k), "rank", { get() { return k; }, set(v) { this.state = v; }, configurable: true }), Object.defineProperty(new Step(k), "state", { value: 1, writable: false })];
function store(o, name, v) { try { setters[name](o, v); return ""; } catch (error) { return error.constructor.name; } }
let last = "";
for (let k = 0; k < 120; k++) {
  const objects = make(k), thrown = [];
  for (const o of objects) for (const name in setters) {
    thrown.push(store(o, name, k), store(o, name, k + 1));
    if (k % 3 == 0) thrown.push(store(o, name, kinds[(k / 3 + objects.indexOf(o)) % kinds.length]));
    thrown.push(store(o, name, -k));
  }
  last = objects.map(digest).join(" ") + " " + thrown.filter(Boolean).length;
  if (k % 30 == 0) console.log(last);
}
console.log(last);
