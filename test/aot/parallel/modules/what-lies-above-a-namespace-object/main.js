// Object.getPrototypeOf() of a namespace object answers an empty object of the run time's own, and a namespace object refuses every other prototype. What the refused call names is not what lies there.
import * as ns from "./exports.js";
globalThis.held = [ns];
const [untyped] = globalThis.held;
function attempt(action) {
  try {
    return `returned ${String(action())}`;
  } catch (error) {
    return `threw ${error.name}`;
  }
}
console.log(attempt(() => Object.setPrototypeOf(untyped, { marker: 7, other: "text" })));
const p = Object.getPrototypeOf(untyped);
console.log(p === null ? "null" : p.marker, p === null ? "null" : typeof p.other, p === null ? "null" : Object.keys(p).length);
const q = Object.getPrototypeOf(ns);
console.log(q === null ? "null" : q.marker, q === null, typeof q);
console.log(attempt(() => Reflect.setPrototypeOf(ns, { marker: 8 })));
const r = Reflect.getPrototypeOf(ns);
console.log(r === null ? "null" : r.marker, "marker" in ns, ns.marker, ns.a, ns.f());
