// node:zlib shares the parameter with a value the compiler cannot follow. Reflect.get() reads it with a receiver, and its functions are called by dynamic keys.
import * as zlib from "node:zlib";
const hide = value => new CustomEvent("x", { detail: value }).detail;
function membersOf(object) {
  hide(object);
  return key => Reflect.get(object, key, {});
}
membersOf(hide({ a: 1 }));
const z = () => zlib;
const member = membersOf(z());
console.log(member(hide("gunzipSync"))(member(hide("gzipSync"))("hello")).toString());
