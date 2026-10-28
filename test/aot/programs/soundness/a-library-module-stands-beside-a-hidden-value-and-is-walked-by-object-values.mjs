// The namespace object of node:zlib stands at a parameter beside a value that the compiler cannot follow; Object.values walks it there, and what is found is called under keys that the compiler cannot follow. ../../flow-schedules.test.ts builds it under four schedules.
import * as zlib from "node:zlib";
const hide = value => new CustomEvent("x", { detail: value }).detail;
function membersOf(object) {
  hide(object);
  const names = Object.keys(object);
  const all = Object.values(object);
  return key => all[names.indexOf(key)];
}
membersOf(hide({ a: 1 }));
const z = () => zlib;
const member = membersOf(z());
console.log(member(hide("gunzipSync"))(member(hide("gzipSync"))("hello")).toString());
