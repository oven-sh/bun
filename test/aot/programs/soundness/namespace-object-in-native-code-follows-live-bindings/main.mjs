// A namespace object reaches code nobody sees. An export is assigned afterwards, in a function that is found late, and an exported function is called through the hidden namespace object.
import * as ns from "./exporting.mjs";
function show(...parts) { let text = ""; for (let i = 0; i < parts.length; i++) text += (i ? " | " : "") + String(parts[i]); console.log(text); }
let stash;
const box = new Proxy({}, { set(target, key, value) { stash = value; return true; }, get() { return stash; } });
function hide(value) { box.kept = value; return box.kept; }
class Leaking { constructor() { leak(this); this.key = "early"; } }
let seen;
function leak(o) { seen = o.key; }
new Leaking();
const u = hide(ns);
show("1", typeof u.value, typeof u.fn, typeof u.later);
const table = { early() {}, undefined() { ns.change(); } };
table[seen]();
show("2", typeof u.value, typeof ns.value, u.fn("x"), u.fn(1), u.later("s"), Object.keys(u).join());
