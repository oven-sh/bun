// The namespace object of node:zlib reaches a parameter through ten calls, long after a value that the compiler cannot follow; Reflect.get reads it there, and what is found is called under keys that the compiler cannot follow. ../../flow-schedules.test.ts builds it under four schedules.
import * as zlib from "node:zlib";
const hide = value => new CustomEvent("x", { detail: value }).detail;
function membersOf(object) {
  hide(object);
  return key => Reflect.get(object, key);
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
