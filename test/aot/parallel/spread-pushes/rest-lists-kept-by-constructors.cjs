// A constructor keeps the list of its arguments where it pushes it to an empty list, and only where nothing can tell.
"use strict";
class Kept { static #made = 0; #list = []; constructor(...xs) { Kept.#made++; this.#list.push(...xs); } add(x) { this.#list.push(x); return this; } get list() { return this.#list; } static get made() { return Kept.#made; } }
class Named { #list = []; constructor(name, ...xs) { this.name = name; this.#list.push(...xs); } get list() { return this.#list; } }
class Looped { #lists = []; constructor(...xs) { for (let k = 0; k < 3; k++) { const list = []; list.push(...xs); list.push(k); this.#lists.push(list); } } get list() { return this.#lists; } }
class Caught { #list = []; constructor(throws, ...xs) { try { if (throws) throw new Error("early"); this.#list.push(...xs); } catch (error) { this.#list.push(error.message); } } get list() { return this.#list; } }
class Interposed { #list = []; constructor(hook, ...xs) { hook(); this.#list.push(...xs); } get list() { return this.#list; } }
class Twice { #a = []; #b = []; constructor(...xs) { this.#a.push(...xs); this.#b.push(...xs); this.#b.push("b"); } get list() { return [this.#a, this.#b]; } }
class Branched { #list = []; constructor(taken, ...xs) { if (taken) this.#list.push(...xs); this.#list.push("end"); } get list() { return this.#list; } }
class Read { #list = []; constructor(...xs) { this.before = this.#list.length; this.#list.push(...xs); this.behind = this.#list.length; } get list() { return [this.before, this.behind, this.#list]; } }
class Later { #list = []; constructor(...xs) { this.#list.push(...xs); this.first = xs[0]; xs.push("later"); this.count = xs.length; } get list() { return [this.first, this.count, this.#list]; } }
class Filled { #list = []; constructor(...xs) { this.#list.push("head"); this.#list.push(...xs); } get list() { return this.#list; } }
class Guarded { #list = []; constructor(limit, ...xs) { if (limit < 0) throw new RangeError("negative"); this.#list.push(...xs); } get list() { return this.#list; } }
class Open { constructor(...xs) { this.list = []; this.list.push(...xs); } }
class Below extends Open { constructor(...xs) { super(...xs, "below"); this.own = []; this.own.push(...xs); } }
const show = (value) => Array.isArray(value) ? "[" + Array.from(value, (item, k) => (k in value ? "" : "hole ") + show(item)).join() + "]" : Object.is(value, -0) ? "-0" : value && typeof value === "object" ? "{" + Object.keys(value).map((key) => key + ":" + show(value[key])).join() + "}" : typeof value + " " + String(value);
let hooks = 0;
const hook = () => { hooks++; };
const attempt = (action) => { try { return action(); } catch (error) { return error.name + " " + error.message; } };
const held = [];
function make(k, source, o) {
  return [
    new Kept(k, 2).add(0.5), new Kept().add(k), new Kept("s", o).add(null), new Kept(k / 2).add(k), new Kept(...source).add("x"), new Named("n", k, o), new Named("m"), new Looped(k, "l"), new Looped(),
    new Caught(true, k, 1), new Caught(false, k, 2), new Interposed(hook, k, "i"), new Twice(k, o), new Twice(), new Branched(true, k), new Branched(false, k), new Read(k, 1, 2), new Read(), new Later(k, "q"), new Filled(k), new Filled(),
    new Guarded(1, k), new Open(k, 1), new Open(), new Below(k, o), new Below(),
  ];
}
for (let k = 0; k < 300; k++) {
  const source = [k, k + 1], o = { k };
  const made = make(k, source, o);
  held.push(made[k % made.length], attempt(() => new Guarded(-1, k)));
  if (held.length > 80) held.splice(0, 60);
  if (k % 60 == 0) console.log(made.map((item) => show(item.list) + (item.own ? show(item.own) : "")).join(" "), show(source), hooks, Kept.made);
}
console.log(show(held.map((item) => item.list ?? item)));
