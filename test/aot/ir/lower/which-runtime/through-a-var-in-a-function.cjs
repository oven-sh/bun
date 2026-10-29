// The other arm of each test requires a file that is not there: a build that followed it would report it.
// RUN: lower

var c0 = typeof Bun !== "undefined";
function f0() {
  if (c0) return 0;
  return require("./for-another-runtime-0.js");
}
console.log(f0());
var c1 = typeof Bun != "undefined";
function f1() {
  if (c1) return 1;
  return require("./for-another-runtime-1.js");
}
console.log(f1());
var c2 = "undefined" !== typeof Bun;
function f2() {
  if (c2) return 2;
  return require("./for-another-runtime-2.js");
}
console.log(f2());
var c3 = typeof Bun === "object";
function f3() {
  if (c3) return 3;
  return require("./for-another-runtime-3.js");
}
console.log(f3());
var c4 = globalThis.Bun;
function f4() {
  if (c4) return 4;
  return require("./for-another-runtime-4.js");
}
console.log(f4());
var c5 = globalThis.Bun !== undefined;
function f5() {
  if (c5) return 5;
  return require("./for-another-runtime-5.js");
}
console.log(f5());
var c6 = typeof globalThis.Bun !== "undefined";
function f6() {
  if (c6) return 6;
  return require("./for-another-runtime-6.js");
}
console.log(f6());
var c7 = "Bun" in globalThis;
function f7() {
  if (c7) return 7;
  return require("./for-another-runtime-7.js");
}
console.log(f7());
var c8 = globalThis?.Bun;
function f8() {
  if (c8) return 8;
  return require("./for-another-runtime-8.js");
}
console.log(f8());
var c9 = globalThis.Bun != null;
function f9() {
  if (c9) return 9;
  return require("./for-another-runtime-9.js");
}
console.log(f9());
var c10 = typeof process !== "undefined";
function f10() {
  if (c10) return 10;
  return require("./for-another-runtime-10.js");
}
console.log(f10());
var c11 = typeof process === "object";
function f11() {
  if (c11) return 11;
  return require("./for-another-runtime-11.js");
}
console.log(f11());
var c12 = globalThis.process;
function f12() {
  if (c12) return 12;
  return require("./for-another-runtime-12.js");
}
console.log(f12());
var c13 = globalThis.process !== undefined;
function f13() {
  if (c13) return 13;
  return require("./for-another-runtime-13.js");
}
console.log(f13());
var c14 = "process" in globalThis;
function f14() {
  if (c14) return 14;
  return require("./for-another-runtime-14.js");
}
console.log(f14());
var c15 = process.isBun;
function f15() {
  if (c15) return 15;
  return require("./for-another-runtime-15.js");
}
console.log(f15());
var c16 = process.isBun === true;
function f16() {
  if (c16) return 16;
  return require("./for-another-runtime-16.js");
}
console.log(f16());
var c17 = process?.isBun;
function f17() {
  if (c17) return 17;
  return require("./for-another-runtime-17.js");
}
console.log(f17());
var c18 = "isBun" in process;
function f18() {
  if (c18) return 18;
  return require("./for-another-runtime-18.js");
}
console.log(f18());
var c19 = typeof process.versions === "object";
function f19() {
  if (c19) return 19;
  return require("./for-another-runtime-19.js");
}
console.log(f19());
var c20 = process.versions !== null;
function f20() {
  if (c20) return 20;
  return require("./for-another-runtime-20.js");
}
console.log(f20());
var c21 = process.versions != null;
function f21() {
  if (c21) return 21;
  return require("./for-another-runtime-21.js");
}
console.log(f21());
var c22 = "versions" in process;
function f22() {
  if (c22) return 22;
  return require("./for-another-runtime-22.js");
}
console.log(f22());
var c23 = process.versions.bun;
function f23() {
  if (c23) return 23;
  return require("./for-another-runtime-23.js");
}
console.log(f23());
var c24 = process.versions.bun !== undefined;
function f24() {
  if (c24) return 24;
  return require("./for-another-runtime-24.js");
}
console.log(f24());
var c25 = typeof process.versions.bun === "string";
function f25() {
  if (c25) return 25;
  return require("./for-another-runtime-25.js");
}
console.log(f25());
var c26 = process.versions?.bun;
function f26() {
  if (c26) return 26;
  return require("./for-another-runtime-26.js");
}
console.log(f26());
var c27 = process?.versions?.bun;
function f27() {
  if (c27) return 27;
  return require("./for-another-runtime-27.js");
}
console.log(f27());
var c28 = globalThis.process?.versions?.bun;
function f28() {
  if (c28) return 28;
  return require("./for-another-runtime-28.js");
}
console.log(f28());
var c29 = "bun" in process.versions;
function f29() {
  if (c29) return 29;
  return require("./for-another-runtime-29.js");
}
console.log(f29());
var c30 = process.versions.node;
function f30() {
  if (c30) return 30;
  return require("./for-another-runtime-30.js");
}
console.log(f30());
var c31 = typeof process.versions.node === "string";
function f31() {
  if (c31) return 31;
  return require("./for-another-runtime-31.js");
}
console.log(f31());
var c32 = "node" in process.versions;
function f32() {
  if (c32) return 32;
  return require("./for-another-runtime-32.js");
}
console.log(f32());
var c33 = typeof process.release === "object";
function f33() {
  if (c33) return 33;
  return require("./for-another-runtime-33.js");
}
console.log(f33());
var c34 = process.release.name === "node";
function f34() {
  if (c34) return 34;
  return require("./for-another-runtime-34.js");
}
console.log(f34());
var c35 = process.release?.name !== "io.js";
function f35() {
  if (c35) return 35;
  return require("./for-another-runtime-35.js");
}
console.log(f35());
var c36 = typeof require === "function";
function f36() {
  if (c36) return 36;
  return require("./for-another-runtime-36.js");
}
console.log(f36());
var c37 = typeof module !== "undefined";
function f37() {
  if (c37) return 37;
  return require("./for-another-runtime-37.js");
}
console.log(f37());
var c38 =
  typeof process !== "undefined" &&
  typeof process.versions === "object" &&
  process.versions !== null &&
  typeof process.versions.bun === "string";
function f38() {
  if (c38) return 38;
  return require("./for-another-runtime-38.js");
}
console.log(f38());
var c39 = typeof process !== "undefined" && "bun" in process.versions;
function f39() {
  if (c39) return 39;
  return require("./for-another-runtime-39.js");
}
console.log(f39());
var c40 = typeof process !== "undefined" && process.versions != null && process.versions.node != null;
function f40() {
  if (c40) return 40;
  return require("./for-another-runtime-40.js");
}
console.log(f40());
var c41 = typeof Bun === "undefined" ? false : true;
function f41() {
  if (c41) return 41;
  return require("./for-another-runtime-41.js");
}
console.log(f41());
var c42 = typeof Bun === "undefined" || !("Bun" in globalThis) ? 0 : 1;
function f42() {
  if (c42) return 42;
  return require("./for-another-runtime-42.js");
}
console.log(f42());
var c43 = typeof Bun === "undefined" || typeof process === "undefined" ? 0 : 1;
function f43() {
  if (c43) return 43;
  return require("./for-another-runtime-43.js");
}
console.log(f43());
