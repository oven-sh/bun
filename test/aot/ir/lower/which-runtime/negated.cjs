// The other arm of each test requires a file that is not there: a build that followed it would report it.
// RUN: lower

if (!(typeof Bun !== "undefined")) console.log(require("./for-another-runtime-0.js"));
else console.log(0);
if (!(typeof Bun != "undefined")) console.log(require("./for-another-runtime-1.js"));
else console.log(1);
if (!("undefined" !== typeof Bun)) console.log(require("./for-another-runtime-2.js"));
else console.log(2);
if (!(typeof Bun === "object")) console.log(require("./for-another-runtime-3.js"));
else console.log(3);
if (!globalThis.Bun) console.log(require("./for-another-runtime-4.js"));
else console.log(4);
if (!(globalThis.Bun !== undefined)) console.log(require("./for-another-runtime-5.js"));
else console.log(5);
if (!(typeof globalThis.Bun !== "undefined")) console.log(require("./for-another-runtime-6.js"));
else console.log(6);
if (!("Bun" in globalThis)) console.log(require("./for-another-runtime-7.js"));
else console.log(7);
if (!globalThis?.Bun) console.log(require("./for-another-runtime-8.js"));
else console.log(8);
if (!(globalThis.Bun != null)) console.log(require("./for-another-runtime-9.js"));
else console.log(9);
if (!(typeof process !== "undefined")) console.log(require("./for-another-runtime-10.js"));
else console.log(10);
if (!(typeof process === "object")) console.log(require("./for-another-runtime-11.js"));
else console.log(11);
if (!globalThis.process) console.log(require("./for-another-runtime-12.js"));
else console.log(12);
if (!(globalThis.process !== undefined)) console.log(require("./for-another-runtime-13.js"));
else console.log(13);
if (!("process" in globalThis)) console.log(require("./for-another-runtime-14.js"));
else console.log(14);
if (!process.isBun) console.log(require("./for-another-runtime-15.js"));
else console.log(15);
if (!(process.isBun === true)) console.log(require("./for-another-runtime-16.js"));
else console.log(16);
if (!process?.isBun) console.log(require("./for-another-runtime-17.js"));
else console.log(17);
if (!("isBun" in process)) console.log(require("./for-another-runtime-18.js"));
else console.log(18);
if (!(typeof process.versions === "object")) console.log(require("./for-another-runtime-19.js"));
else console.log(19);
if (!(process.versions !== null)) console.log(require("./for-another-runtime-20.js"));
else console.log(20);
if (!(process.versions != null)) console.log(require("./for-another-runtime-21.js"));
else console.log(21);
if (!("versions" in process)) console.log(require("./for-another-runtime-22.js"));
else console.log(22);
if (!process.versions.bun) console.log(require("./for-another-runtime-23.js"));
else console.log(23);
if (!(process.versions.bun !== undefined)) console.log(require("./for-another-runtime-24.js"));
else console.log(24);
if (!(typeof process.versions.bun === "string")) console.log(require("./for-another-runtime-25.js"));
else console.log(25);
if (!process.versions?.bun) console.log(require("./for-another-runtime-26.js"));
else console.log(26);
if (!process?.versions?.bun) console.log(require("./for-another-runtime-27.js"));
else console.log(27);
if (!globalThis.process?.versions?.bun) console.log(require("./for-another-runtime-28.js"));
else console.log(28);
if (!("bun" in process.versions)) console.log(require("./for-another-runtime-29.js"));
else console.log(29);
if (!process.versions.node) console.log(require("./for-another-runtime-30.js"));
else console.log(30);
if (!(typeof process.versions.node === "string")) console.log(require("./for-another-runtime-31.js"));
else console.log(31);
if (!("node" in process.versions)) console.log(require("./for-another-runtime-32.js"));
else console.log(32);
if (!(typeof process.release === "object")) console.log(require("./for-another-runtime-33.js"));
else console.log(33);
if (!(process.release.name === "node")) console.log(require("./for-another-runtime-34.js"));
else console.log(34);
if (!(process.release?.name !== "io.js")) console.log(require("./for-another-runtime-35.js"));
else console.log(35);
if (!(typeof require === "function")) console.log(require("./for-another-runtime-36.js"));
else console.log(36);
if (!(typeof module !== "undefined")) console.log(require("./for-another-runtime-37.js"));
else console.log(37);
if (
  !(
    typeof process !== "undefined" &&
    typeof process.versions === "object" &&
    process.versions !== null &&
    typeof process.versions.bun === "string"
  )
)
  console.log(require("./for-another-runtime-38.js"));
else console.log(38);
if (!(typeof process !== "undefined" && "bun" in process.versions)) console.log(require("./for-another-runtime-39.js"));
else console.log(39);
if (!(typeof process !== "undefined" && process.versions != null && process.versions.node != null))
  console.log(require("./for-another-runtime-40.js"));
else console.log(40);
if (!(typeof Bun === "undefined" ? false : true)) console.log(require("./for-another-runtime-41.js"));
else console.log(41);
if (!(typeof Bun === "undefined" || !("Bun" in globalThis) ? 0 : 1))
  console.log(require("./for-another-runtime-42.js"));
else console.log(42);
if (!(typeof Bun === "undefined" || typeof process === "undefined" ? 0 : 1))
  console.log(require("./for-another-runtime-43.js"));
else console.log(43);
