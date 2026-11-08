// The other arm of each test requires a file that is not there: a build that followed it would report it.
// RUN: lower

console.log(!!(typeof Bun !== "undefined") || require("./for-another-runtime-0.js"), 0);
console.log(!!(typeof Bun != "undefined") || require("./for-another-runtime-1.js"), 1);
console.log(!!("undefined" !== typeof Bun) || require("./for-another-runtime-2.js"), 2);
console.log(!!(typeof Bun === "object") || require("./for-another-runtime-3.js"), 3);
console.log(!!globalThis.Bun || require("./for-another-runtime-4.js"), 4);
console.log(!!(globalThis.Bun !== undefined) || require("./for-another-runtime-5.js"), 5);
console.log(!!(typeof globalThis.Bun !== "undefined") || require("./for-another-runtime-6.js"), 6);
console.log(!!("Bun" in globalThis) || require("./for-another-runtime-7.js"), 7);
console.log(!!globalThis?.Bun || require("./for-another-runtime-8.js"), 8);
console.log(!!(globalThis.Bun != null) || require("./for-another-runtime-9.js"), 9);
console.log(!!(typeof process !== "undefined") || require("./for-another-runtime-10.js"), 10);
console.log(!!(typeof process === "object") || require("./for-another-runtime-11.js"), 11);
console.log(!!globalThis.process || require("./for-another-runtime-12.js"), 12);
console.log(!!(globalThis.process !== undefined) || require("./for-another-runtime-13.js"), 13);
console.log(!!("process" in globalThis) || require("./for-another-runtime-14.js"), 14);
console.log(!!process.isBun || require("./for-another-runtime-15.js"), 15);
console.log(!!(process.isBun === true) || require("./for-another-runtime-16.js"), 16);
console.log(!!process?.isBun || require("./for-another-runtime-17.js"), 17);
console.log(!!("isBun" in process) || require("./for-another-runtime-18.js"), 18);
console.log(!!(typeof process.versions === "object") || require("./for-another-runtime-19.js"), 19);
console.log(!!(process.versions !== null) || require("./for-another-runtime-20.js"), 20);
console.log(!!(process.versions != null) || require("./for-another-runtime-21.js"), 21);
console.log(!!("versions" in process) || require("./for-another-runtime-22.js"), 22);
console.log(!!process.versions.bun || require("./for-another-runtime-23.js"), 23);
console.log(!!(process.versions.bun !== undefined) || require("./for-another-runtime-24.js"), 24);
console.log(!!(typeof process.versions.bun === "string") || require("./for-another-runtime-25.js"), 25);
console.log(!!process.versions?.bun || require("./for-another-runtime-26.js"), 26);
console.log(!!process?.versions?.bun || require("./for-another-runtime-27.js"), 27);
console.log(!!globalThis.process?.versions?.bun || require("./for-another-runtime-28.js"), 28);
console.log(!!("bun" in process.versions) || require("./for-another-runtime-29.js"), 29);
console.log(!!process.versions.node || require("./for-another-runtime-30.js"), 30);
console.log(!!(typeof process.versions.node === "string") || require("./for-another-runtime-31.js"), 31);
console.log(!!("node" in process.versions) || require("./for-another-runtime-32.js"), 32);
console.log(!!(typeof process.release === "object") || require("./for-another-runtime-33.js"), 33);
console.log(!!(process.release.name === "node") || require("./for-another-runtime-34.js"), 34);
console.log(!!(process.release?.name !== "io.js") || require("./for-another-runtime-35.js"), 35);
console.log(!!(typeof require === "function") || require("./for-another-runtime-36.js"), 36);
console.log(!!(typeof module !== "undefined") || require("./for-another-runtime-37.js"), 37);
console.log(
  !!(
    typeof process !== "undefined" &&
    typeof process.versions === "object" &&
    process.versions !== null &&
    typeof process.versions.bun === "string"
  ) || require("./for-another-runtime-38.js"),
  38,
);
console.log(
  !!(typeof process !== "undefined" && "bun" in process.versions) || require("./for-another-runtime-39.js"),
  39,
);
console.log(
  !!(typeof process !== "undefined" && process.versions != null && process.versions.node != null) ||
    require("./for-another-runtime-40.js"),
  40,
);
console.log(!!(typeof Bun === "undefined" ? false : true) || require("./for-another-runtime-41.js"), 41);
console.log(
  !!(typeof Bun === "undefined" || !("Bun" in globalThis) ? 0 : 1) || require("./for-another-runtime-42.js"),
  42,
);
console.log(
  !!(typeof Bun === "undefined" || typeof process === "undefined" ? 0 : 1) || require("./for-another-runtime-43.js"),
  43,
);
