// node:zlib shares the parameter with a value the compiler cannot follow. Object.create() makes it the prototype of a new object, and its functions are called by dynamic keys. Also built by ../../flow-schedules.test.ts.
import * as zlib from "node:zlib";
const hide = value => new CustomEvent("x", { detail: value }).detail;
function membersOf(object) {
  hide(object);
  const below = Object.create(object);
  return key => below[key];
}
membersOf(hide({ a: 1 }));
const z = () => zlib;
const member = membersOf(z());
console.log(member(hide("gunzipSync"))(member(hide("gzipSync"))("hello")).toString());
