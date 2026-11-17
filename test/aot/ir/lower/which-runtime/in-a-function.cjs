// The other arm of each test requires a file that is not there: a build that followed it would report it.
// RUN: lower

function f0() {
  return typeof Bun !== "undefined" ? 0 : require("./for-another-runtime-0.js");
}
console.log(f0());
function f1() {
  return typeof Bun != "undefined" ? 1 : require("./for-another-runtime-1.js");
}
console.log(f1());
function f2() {
  return "undefined" !== typeof Bun ? 2 : require("./for-another-runtime-2.js");
}
console.log(f2());
function f3() {
  return typeof Bun === "object" ? 3 : require("./for-another-runtime-3.js");
}
console.log(f3());
function f4() {
  return globalThis.Bun ? 4 : require("./for-another-runtime-4.js");
}
console.log(f4());
function f5() {
  return globalThis.Bun !== undefined ? 5 : require("./for-another-runtime-5.js");
}
console.log(f5());
function f6() {
  return typeof globalThis.Bun !== "undefined" ? 6 : require("./for-another-runtime-6.js");
}
console.log(f6());
function f7() {
  return "Bun" in globalThis ? 7 : require("./for-another-runtime-7.js");
}
console.log(f7());
function f8() {
  return globalThis?.Bun ? 8 : require("./for-another-runtime-8.js");
}
console.log(f8());
function f9() {
  return globalThis.Bun != null ? 9 : require("./for-another-runtime-9.js");
}
console.log(f9());
function f10() {
  return typeof process !== "undefined" ? 10 : require("./for-another-runtime-10.js");
}
console.log(f10());
function f11() {
  return typeof process === "object" ? 11 : require("./for-another-runtime-11.js");
}
console.log(f11());
function f12() {
  return globalThis.process ? 12 : require("./for-another-runtime-12.js");
}
console.log(f12());
function f13() {
  return globalThis.process !== undefined ? 13 : require("./for-another-runtime-13.js");
}
console.log(f13());
function f14() {
  return "process" in globalThis ? 14 : require("./for-another-runtime-14.js");
}
console.log(f14());
function f15() {
  return process.isBun ? 15 : require("./for-another-runtime-15.js");
}
console.log(f15());
function f16() {
  return process.isBun === true ? 16 : require("./for-another-runtime-16.js");
}
console.log(f16());
function f17() {
  return process?.isBun ? 17 : require("./for-another-runtime-17.js");
}
console.log(f17());
function f18() {
  return "isBun" in process ? 18 : require("./for-another-runtime-18.js");
}
console.log(f18());
function f19() {
  return typeof process.versions === "object" ? 19 : require("./for-another-runtime-19.js");
}
console.log(f19());
function f20() {
  return process.versions !== null ? 20 : require("./for-another-runtime-20.js");
}
console.log(f20());
function f21() {
  return process.versions != null ? 21 : require("./for-another-runtime-21.js");
}
console.log(f21());
function f22() {
  return "versions" in process ? 22 : require("./for-another-runtime-22.js");
}
console.log(f22());
function f23() {
  return process.versions.bun ? 23 : require("./for-another-runtime-23.js");
}
console.log(f23());
function f24() {
  return process.versions.bun !== undefined ? 24 : require("./for-another-runtime-24.js");
}
console.log(f24());
function f25() {
  return typeof process.versions.bun === "string" ? 25 : require("./for-another-runtime-25.js");
}
console.log(f25());
function f26() {
  return process.versions?.bun ? 26 : require("./for-another-runtime-26.js");
}
console.log(f26());
function f27() {
  return process?.versions?.bun ? 27 : require("./for-another-runtime-27.js");
}
console.log(f27());
function f28() {
  return globalThis.process?.versions?.bun ? 28 : require("./for-another-runtime-28.js");
}
console.log(f28());
function f29() {
  return "bun" in process.versions ? 29 : require("./for-another-runtime-29.js");
}
console.log(f29());
function f30() {
  return process.versions.node ? 30 : require("./for-another-runtime-30.js");
}
console.log(f30());
function f31() {
  return typeof process.versions.node === "string" ? 31 : require("./for-another-runtime-31.js");
}
console.log(f31());
function f32() {
  return "node" in process.versions ? 32 : require("./for-another-runtime-32.js");
}
console.log(f32());
function f33() {
  return typeof process.release === "object" ? 33 : require("./for-another-runtime-33.js");
}
console.log(f33());
function f34() {
  return process.release.name === "node" ? 34 : require("./for-another-runtime-34.js");
}
console.log(f34());
function f35() {
  return process.release?.name !== "io.js" ? 35 : require("./for-another-runtime-35.js");
}
console.log(f35());
function f36() {
  return typeof require === "function" ? 36 : require("./for-another-runtime-36.js");
}
console.log(f36());
function f37() {
  return typeof module !== "undefined" ? 37 : require("./for-another-runtime-37.js");
}
console.log(f37());
function f38() {
  return typeof process !== "undefined" &&
    typeof process.versions === "object" &&
    process.versions !== null &&
    typeof process.versions.bun === "string"
    ? 38
    : require("./for-another-runtime-38.js");
}
console.log(f38());
function f39() {
  return typeof process !== "undefined" && "bun" in process.versions ? 39 : require("./for-another-runtime-39.js");
}
console.log(f39());
function f40() {
  return typeof process !== "undefined" && process.versions != null && process.versions.node != null
    ? 40
    : require("./for-another-runtime-40.js");
}
console.log(f40());
function f41() {
  return (typeof Bun === "undefined" ? false : true) ? 41 : require("./for-another-runtime-41.js");
}
console.log(f41());
function f42() {
  return (typeof Bun === "undefined" || !("Bun" in globalThis) ? 0 : 1) ? 42 : require("./for-another-runtime-42.js");
}
console.log(f42());
function f43() {
  return (typeof Bun === "undefined" || typeof process === "undefined" ? 0 : 1)
    ? 43
    : require("./for-another-runtime-43.js");
}
console.log(f43());
