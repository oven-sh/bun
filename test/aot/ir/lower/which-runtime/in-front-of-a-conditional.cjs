// The other arm of each test requires a file that is not there: a build that followed it would report it.
// RUN: lower

console.log(typeof Bun !== "undefined" ? 0 : require("./for-another-runtime-0.js"));
console.log(typeof Bun != "undefined" ? 1 : require("./for-another-runtime-1.js"));
console.log("undefined" !== typeof Bun ? 2 : require("./for-another-runtime-2.js"));
console.log(typeof Bun === "object" ? 3 : require("./for-another-runtime-3.js"));
console.log(globalThis.Bun ? 4 : require("./for-another-runtime-4.js"));
console.log(globalThis.Bun !== undefined ? 5 : require("./for-another-runtime-5.js"));
console.log(typeof globalThis.Bun !== "undefined" ? 6 : require("./for-another-runtime-6.js"));
console.log("Bun" in globalThis ? 7 : require("./for-another-runtime-7.js"));
console.log(globalThis?.Bun ? 8 : require("./for-another-runtime-8.js"));
console.log(globalThis.Bun != null ? 9 : require("./for-another-runtime-9.js"));
console.log(typeof process !== "undefined" ? 10 : require("./for-another-runtime-10.js"));
console.log(typeof process === "object" ? 11 : require("./for-another-runtime-11.js"));
console.log(globalThis.process ? 12 : require("./for-another-runtime-12.js"));
console.log(globalThis.process !== undefined ? 13 : require("./for-another-runtime-13.js"));
console.log("process" in globalThis ? 14 : require("./for-another-runtime-14.js"));
console.log(process.isBun ? 15 : require("./for-another-runtime-15.js"));
console.log(process.isBun === true ? 16 : require("./for-another-runtime-16.js"));
console.log(process?.isBun ? 17 : require("./for-another-runtime-17.js"));
console.log("isBun" in process ? 18 : require("./for-another-runtime-18.js"));
console.log(typeof process.versions === "object" ? 19 : require("./for-another-runtime-19.js"));
console.log(process.versions !== null ? 20 : require("./for-another-runtime-20.js"));
console.log(process.versions != null ? 21 : require("./for-another-runtime-21.js"));
console.log("versions" in process ? 22 : require("./for-another-runtime-22.js"));
console.log(process.versions.bun ? 23 : require("./for-another-runtime-23.js"));
console.log(process.versions.bun !== undefined ? 24 : require("./for-another-runtime-24.js"));
console.log(typeof process.versions.bun === "string" ? 25 : require("./for-another-runtime-25.js"));
console.log(process.versions?.bun ? 26 : require("./for-another-runtime-26.js"));
console.log(process?.versions?.bun ? 27 : require("./for-another-runtime-27.js"));
console.log(globalThis.process?.versions?.bun ? 28 : require("./for-another-runtime-28.js"));
console.log("bun" in process.versions ? 29 : require("./for-another-runtime-29.js"));
console.log(process.versions.node ? 30 : require("./for-another-runtime-30.js"));
console.log(typeof process.versions.node === "string" ? 31 : require("./for-another-runtime-31.js"));
console.log("node" in process.versions ? 32 : require("./for-another-runtime-32.js"));
console.log(typeof process.release === "object" ? 33 : require("./for-another-runtime-33.js"));
console.log(process.release.name === "node" ? 34 : require("./for-another-runtime-34.js"));
console.log(process.release?.name !== "io.js" ? 35 : require("./for-another-runtime-35.js"));
console.log(typeof require === "function" ? 36 : require("./for-another-runtime-36.js"));
console.log(typeof module !== "undefined" ? 37 : require("./for-another-runtime-37.js"));
console.log(
  typeof process !== "undefined" &&
    typeof process.versions === "object" &&
    process.versions !== null &&
    typeof process.versions.bun === "string"
    ? 38
    : require("./for-another-runtime-38.js"),
);
console.log(typeof process !== "undefined" && "bun" in process.versions ? 39 : require("./for-another-runtime-39.js"));
console.log(
  typeof process !== "undefined" && process.versions != null && process.versions.node != null
    ? 40
    : require("./for-another-runtime-40.js"),
);
console.log((typeof Bun === "undefined" ? false : true) ? 41 : require("./for-another-runtime-41.js"));
console.log(
  (typeof Bun === "undefined" || !("Bun" in globalThis) ? 0 : 1) ? 42 : require("./for-another-runtime-42.js"),
);
console.log(
  (typeof Bun === "undefined" || typeof process === "undefined" ? 0 : 1) ? 43 : require("./for-another-runtime-43.js"),
);
