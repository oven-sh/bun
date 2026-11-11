// The other arm of each test requires a file that is not there: a build that followed it would report it.
// RUN: lower

if (typeof Bun !== "undefined") console.log(0);
else console.log(require("./for-another-runtime-0.js"));
if (typeof Bun != "undefined") console.log(1);
else console.log(require("./for-another-runtime-1.js"));
if ("undefined" !== typeof Bun) console.log(2);
else console.log(require("./for-another-runtime-2.js"));
if (typeof Bun === "object") console.log(3);
else console.log(require("./for-another-runtime-3.js"));
if (globalThis.Bun) console.log(4);
else console.log(require("./for-another-runtime-4.js"));
if (globalThis.Bun !== undefined) console.log(5);
else console.log(require("./for-another-runtime-5.js"));
if (typeof globalThis.Bun !== "undefined") console.log(6);
else console.log(require("./for-another-runtime-6.js"));
if ("Bun" in globalThis) console.log(7);
else console.log(require("./for-another-runtime-7.js"));
if (globalThis?.Bun) console.log(8);
else console.log(require("./for-another-runtime-8.js"));
if (globalThis.Bun != null) console.log(9);
else console.log(require("./for-another-runtime-9.js"));
if (typeof process !== "undefined") console.log(10);
else console.log(require("./for-another-runtime-10.js"));
if (typeof process === "object") console.log(11);
else console.log(require("./for-another-runtime-11.js"));
if (globalThis.process) console.log(12);
else console.log(require("./for-another-runtime-12.js"));
if (globalThis.process !== undefined) console.log(13);
else console.log(require("./for-another-runtime-13.js"));
if ("process" in globalThis) console.log(14);
else console.log(require("./for-another-runtime-14.js"));
if (process.isBun) console.log(15);
else console.log(require("./for-another-runtime-15.js"));
if (process.isBun === true) console.log(16);
else console.log(require("./for-another-runtime-16.js"));
if (process?.isBun) console.log(17);
else console.log(require("./for-another-runtime-17.js"));
if ("isBun" in process) console.log(18);
else console.log(require("./for-another-runtime-18.js"));
if (typeof process.versions === "object") console.log(19);
else console.log(require("./for-another-runtime-19.js"));
if (process.versions !== null) console.log(20);
else console.log(require("./for-another-runtime-20.js"));
if (process.versions != null) console.log(21);
else console.log(require("./for-another-runtime-21.js"));
if ("versions" in process) console.log(22);
else console.log(require("./for-another-runtime-22.js"));
if (process.versions.bun) console.log(23);
else console.log(require("./for-another-runtime-23.js"));
if (process.versions.bun !== undefined) console.log(24);
else console.log(require("./for-another-runtime-24.js"));
if (typeof process.versions.bun === "string") console.log(25);
else console.log(require("./for-another-runtime-25.js"));
if (process.versions?.bun) console.log(26);
else console.log(require("./for-another-runtime-26.js"));
if (process?.versions?.bun) console.log(27);
else console.log(require("./for-another-runtime-27.js"));
if (globalThis.process?.versions?.bun) console.log(28);
else console.log(require("./for-another-runtime-28.js"));
if ("bun" in process.versions) console.log(29);
else console.log(require("./for-another-runtime-29.js"));
if (process.versions.node) console.log(30);
else console.log(require("./for-another-runtime-30.js"));
if (typeof process.versions.node === "string") console.log(31);
else console.log(require("./for-another-runtime-31.js"));
if ("node" in process.versions) console.log(32);
else console.log(require("./for-another-runtime-32.js"));
if (typeof process.release === "object") console.log(33);
else console.log(require("./for-another-runtime-33.js"));
if (process.release.name === "node") console.log(34);
else console.log(require("./for-another-runtime-34.js"));
if (process.release?.name !== "io.js") console.log(35);
else console.log(require("./for-another-runtime-35.js"));
if (typeof require === "function") console.log(36);
else console.log(require("./for-another-runtime-36.js"));
if (typeof module !== "undefined") console.log(37);
else console.log(require("./for-another-runtime-37.js"));
if (
  typeof process !== "undefined" &&
  typeof process.versions === "object" &&
  process.versions !== null &&
  typeof process.versions.bun === "string"
)
  console.log(38);
else console.log(require("./for-another-runtime-38.js"));
if (typeof process !== "undefined" && "bun" in process.versions) console.log(39);
else console.log(require("./for-another-runtime-39.js"));
if (typeof process !== "undefined" && process.versions != null && process.versions.node != null) console.log(40);
else console.log(require("./for-another-runtime-40.js"));
if (typeof Bun === "undefined" ? false : true) console.log(41);
else console.log(require("./for-another-runtime-41.js"));
if (typeof Bun === "undefined" || !("Bun" in globalThis) ? 0 : 1) console.log(42);
else console.log(require("./for-another-runtime-42.js"));
if (typeof Bun === "undefined" || typeof process === "undefined" ? 0 : 1) console.log(43);
else console.log(require("./for-another-runtime-43.js"));
