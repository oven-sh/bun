// A module is imported by a call in a function that is found late. Its body changes an object that the importer has read before.
import { shared } from "./shared.mjs";
function show(...parts) { let text = ""; for (let i = 0; i < parts.length; i++) text += (i ? " | " : "") + String(parts[i]); console.log(text); }
class Leaking { constructor() { leak(this); this.key = "early"; } }
let seen;
function leak(o) { seen = o.key; }
new Leaking();
show("1", typeof shared.v, shared.f);
const table = { early() { return Promise.resolve({}); }, undefined() { return import("./late.mjs"); } };
const ns = await table[seen]();
show("2", typeof shared.v, shared.f(1), ns.done);
const required = { early() { return {}; }, undefined() { return import("./late.cjs"); } };
const other = await required[seen]();
show("3", typeof shared.w, other.default.name, other.name);
