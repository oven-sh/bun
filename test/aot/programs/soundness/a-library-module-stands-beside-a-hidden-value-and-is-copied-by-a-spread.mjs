// The namespace object of node:zlib stands at a parameter beside a value that the compiler cannot follow; a spread copies it there, and what is found is called under keys that the compiler cannot follow.
import * as zlib from "node:zlib";
const hide = value => new CustomEvent("x", { detail: value }).detail;
function membersOf(object) {
  hide(object);
  const all = { ...object };
  return key => all[key];
}
membersOf(hide({ a: 1 }));
const z = () => zlib;
const member = membersOf(z());
console.log(member(hide("gunzipSync"))(member(hide("gzipSync"))("hello")).toString());
