// node:zlib arrives late at a function that makes it the prototype below a constructor function and a class.
import * as zlib from "node:zlib";
const hide = value => new CustomEvent("x", { detail: value }).detail;
function membersOf(object) {
  hide(object);
  function Base() {}
  Base.prototype = object;
  class Derived extends Base {}
  const below = new Derived();
  return key => below[key];
}
membersOf(hide({ a: 1 }));
const z0 = { get: () => zlib };
const z1 = { get: () => z0.get() };
const z2 = { get: () => z1.get() };
const z3 = { get: () => z2.get() };
const z4 = { get: () => z3.get() };
const z5 = { get: () => z4.get() };
const z6 = { get: () => z5.get() };
const z7 = { get: () => z6.get() };
const z8 = { get: () => z7.get() };
const z9 = { get: () => z8.get() };
const z = () => z9.get();
const member = membersOf(z());
console.log(member(hide("gunzipSync"))(member(hide("gzipSync"))("hello")).toString());
