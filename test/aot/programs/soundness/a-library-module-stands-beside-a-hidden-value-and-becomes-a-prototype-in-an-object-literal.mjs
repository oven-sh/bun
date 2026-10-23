// node:zlib shares the parameter with a value the compiler cannot follow. An object literal has it as __proto__, and its functions are called by dynamic keys.
import * as zlib from "node:zlib";
const hide = value => new CustomEvent("x", { detail: value }).detail;
function membersOf(object) {
  hide(object);
  const below = { __proto__: object };
  return key => below[key];
}
membersOf(hide({ a: 1 }));
const z = () => zlib;
const member = membersOf(z());
console.log(member(hide("gunzipSync"))(member(hide("gzipSync"))("hello")).toString());
