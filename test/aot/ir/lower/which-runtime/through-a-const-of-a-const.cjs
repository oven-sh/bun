// The other arm of each test requires a file that is not there: a build that followed it would report it.
// RUN: lower

const c0 = typeof Bun !== "undefined",
  d0 = !c0;
if (d0) console.log(require("./for-another-runtime-0.js"));
else console.log(0);
const c1 = typeof Bun != "undefined",
  d1 = !c1;
if (d1) console.log(require("./for-another-runtime-1.js"));
else console.log(1);
const c2 = "undefined" !== typeof Bun,
  d2 = !c2;
if (d2) console.log(require("./for-another-runtime-2.js"));
else console.log(2);
const c3 = typeof Bun === "object",
  d3 = !c3;
if (d3) console.log(require("./for-another-runtime-3.js"));
else console.log(3);
const c4 = globalThis.Bun,
  d4 = !c4;
if (d4) console.log(require("./for-another-runtime-4.js"));
else console.log(4);
const c5 = globalThis.Bun !== undefined,
  d5 = !c5;
if (d5) console.log(require("./for-another-runtime-5.js"));
else console.log(5);
const c6 = typeof globalThis.Bun !== "undefined",
  d6 = !c6;
if (d6) console.log(require("./for-another-runtime-6.js"));
else console.log(6);
const c7 = "Bun" in globalThis,
  d7 = !c7;
if (d7) console.log(require("./for-another-runtime-7.js"));
else console.log(7);
const c8 = globalThis?.Bun,
  d8 = !c8;
if (d8) console.log(require("./for-another-runtime-8.js"));
else console.log(8);
const c9 = globalThis.Bun != null,
  d9 = !c9;
if (d9) console.log(require("./for-another-runtime-9.js"));
else console.log(9);
const c10 = typeof process !== "undefined",
  d10 = !c10;
if (d10) console.log(require("./for-another-runtime-10.js"));
else console.log(10);
const c11 = typeof process === "object",
  d11 = !c11;
if (d11) console.log(require("./for-another-runtime-11.js"));
else console.log(11);
const c12 = globalThis.process,
  d12 = !c12;
if (d12) console.log(require("./for-another-runtime-12.js"));
else console.log(12);
const c13 = globalThis.process !== undefined,
  d13 = !c13;
if (d13) console.log(require("./for-another-runtime-13.js"));
else console.log(13);
const c14 = "process" in globalThis,
  d14 = !c14;
if (d14) console.log(require("./for-another-runtime-14.js"));
else console.log(14);
const c15 = process.isBun,
  d15 = !c15;
if (d15) console.log(require("./for-another-runtime-15.js"));
else console.log(15);
const c16 = process.isBun === true,
  d16 = !c16;
if (d16) console.log(require("./for-another-runtime-16.js"));
else console.log(16);
const c17 = process?.isBun,
  d17 = !c17;
if (d17) console.log(require("./for-another-runtime-17.js"));
else console.log(17);
const c18 = "isBun" in process,
  d18 = !c18;
if (d18) console.log(require("./for-another-runtime-18.js"));
else console.log(18);
const c19 = typeof process.versions === "object",
  d19 = !c19;
if (d19) console.log(require("./for-another-runtime-19.js"));
else console.log(19);
const c20 = process.versions !== null,
  d20 = !c20;
if (d20) console.log(require("./for-another-runtime-20.js"));
else console.log(20);
const c21 = process.versions != null,
  d21 = !c21;
if (d21) console.log(require("./for-another-runtime-21.js"));
else console.log(21);
const c22 = "versions" in process,
  d22 = !c22;
if (d22) console.log(require("./for-another-runtime-22.js"));
else console.log(22);
const c23 = process.versions.bun,
  d23 = !c23;
if (d23) console.log(require("./for-another-runtime-23.js"));
else console.log(23);
const c24 = process.versions.bun !== undefined,
  d24 = !c24;
if (d24) console.log(require("./for-another-runtime-24.js"));
else console.log(24);
const c25 = typeof process.versions.bun === "string",
  d25 = !c25;
if (d25) console.log(require("./for-another-runtime-25.js"));
else console.log(25);
const c26 = process.versions?.bun,
  d26 = !c26;
if (d26) console.log(require("./for-another-runtime-26.js"));
else console.log(26);
const c27 = process?.versions?.bun,
  d27 = !c27;
if (d27) console.log(require("./for-another-runtime-27.js"));
else console.log(27);
const c28 = globalThis.process?.versions?.bun,
  d28 = !c28;
if (d28) console.log(require("./for-another-runtime-28.js"));
else console.log(28);
const c29 = "bun" in process.versions,
  d29 = !c29;
if (d29) console.log(require("./for-another-runtime-29.js"));
else console.log(29);
const c30 = process.versions.node,
  d30 = !c30;
if (d30) console.log(require("./for-another-runtime-30.js"));
else console.log(30);
const c31 = typeof process.versions.node === "string",
  d31 = !c31;
if (d31) console.log(require("./for-another-runtime-31.js"));
else console.log(31);
const c32 = "node" in process.versions,
  d32 = !c32;
if (d32) console.log(require("./for-another-runtime-32.js"));
else console.log(32);
const c33 = typeof process.release === "object",
  d33 = !c33;
if (d33) console.log(require("./for-another-runtime-33.js"));
else console.log(33);
const c34 = process.release.name === "node",
  d34 = !c34;
if (d34) console.log(require("./for-another-runtime-34.js"));
else console.log(34);
const c35 = process.release?.name !== "io.js",
  d35 = !c35;
if (d35) console.log(require("./for-another-runtime-35.js"));
else console.log(35);
const c36 = typeof require === "function",
  d36 = !c36;
if (d36) console.log(require("./for-another-runtime-36.js"));
else console.log(36);
const c37 = typeof module !== "undefined",
  d37 = !c37;
if (d37) console.log(require("./for-another-runtime-37.js"));
else console.log(37);
const c38 =
    typeof process !== "undefined" &&
    typeof process.versions === "object" &&
    process.versions !== null &&
    typeof process.versions.bun === "string",
  d38 = !c38;
if (d38) console.log(require("./for-another-runtime-38.js"));
else console.log(38);
const c39 = typeof process !== "undefined" && "bun" in process.versions,
  d39 = !c39;
if (d39) console.log(require("./for-another-runtime-39.js"));
else console.log(39);
const c40 = typeof process !== "undefined" && process.versions != null && process.versions.node != null,
  d40 = !c40;
if (d40) console.log(require("./for-another-runtime-40.js"));
else console.log(40);
const c41 = typeof Bun === "undefined" ? false : true,
  d41 = !c41;
if (d41) console.log(require("./for-another-runtime-41.js"));
else console.log(41);
const c42 = typeof Bun === "undefined" || !("Bun" in globalThis) ? 0 : 1,
  d42 = !c42;
if (d42) console.log(require("./for-another-runtime-42.js"));
else console.log(42);
const c43 = typeof Bun === "undefined" || typeof process === "undefined" ? 0 : 1,
  d43 = !c43;
if (d43) console.log(require("./for-another-runtime-43.js"));
else console.log(43);
