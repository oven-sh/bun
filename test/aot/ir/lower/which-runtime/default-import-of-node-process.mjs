// The other arm of each test requires a file that is not there: a build that followed it would report it.
// RUN: lower

import process from "node:process";
console.log(process.isBun ? 0 : await import("./for-another-runtime-0.js"));
console.log(process.isBun === true ? 1 : await import("./for-another-runtime-1.js"));
console.log(process?.isBun ? 2 : await import("./for-another-runtime-2.js"));
console.log(typeof process.versions === "object" ? 3 : await import("./for-another-runtime-3.js"));
console.log(process.versions !== null ? 4 : await import("./for-another-runtime-4.js"));
console.log(process.versions != null ? 5 : await import("./for-another-runtime-5.js"));
console.log(process.versions.bun ? 6 : await import("./for-another-runtime-6.js"));
console.log(process.versions.bun !== undefined ? 7 : await import("./for-another-runtime-7.js"));
console.log(typeof process.versions.bun === "string" ? 8 : await import("./for-another-runtime-8.js"));
console.log(process.versions?.bun ? 9 : await import("./for-another-runtime-9.js"));
console.log(process?.versions?.bun ? 10 : await import("./for-another-runtime-10.js"));
console.log(process.versions.node ? 11 : await import("./for-another-runtime-11.js"));
console.log(typeof process.versions.node === "string" ? 12 : await import("./for-another-runtime-12.js"));
console.log(typeof process.release === "object" ? 13 : await import("./for-another-runtime-13.js"));
console.log(process.release.name === "node" ? 14 : await import("./for-another-runtime-14.js"));
console.log(process.release?.name !== "io.js" ? 15 : await import("./for-another-runtime-15.js"));
