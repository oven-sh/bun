// Alone: the order in which flow sees the two tables depends on what else the executable holds
// An emitter stores a listener in its table under the name of the event. Here the table is String.prototype, which arrives through fifteen calls.
import { EventEmitter } from "node:events";
const hide = value => new CustomEvent("x", { detail: value }).detail;
function listener() {
  return "the listener ran on " + this;
}
const other = new EventEmitter();
other._events = hide({});
other.on(hide("x"), listener);
const l0 = { get: () => String.prototype };
const l1 = { get: () => l0.get() };
const l2 = { get: () => l1.get() };
const l3 = { get: () => l2.get() };
const l4 = { get: () => l3.get() };
const l5 = { get: () => l4.get() };
const l6 = { get: () => l5.get() };
const l7 = { get: () => l6.get() };
const l8 = { get: () => l7.get() };
const l9 = { get: () => l8.get() };
const l10 = { get: () => l9.get() };
const l11 = { get: () => l10.get() };
const l12 = { get: () => l11.get() };
const l13 = { get: () => l12.get() };
const l14 = { get: () => l13.get() };
const l15 = { get: () => l14.get() };
const emitter = new EventEmitter();
emitter._events = l15.get();
for (const name of ["shout", "trim", "at"]) {
  try {
    emitter.on(hide(name), listener);
    console.log(name, "heard");
  } catch (error) {
    console.log(name, error.name);
  }
}
console.log(
  "x".shout(),
  "|",
  Array.isArray(" x ".trim),
  " x ".trim.length,
  "|",
  Array.isArray("x".at),
  "x".at[1] === listener,
);
