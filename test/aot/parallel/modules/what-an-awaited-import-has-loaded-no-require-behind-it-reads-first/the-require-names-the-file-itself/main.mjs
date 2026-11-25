await import("./middle.mjs");
const again = require("./plain.cjs");
console.log(globalThis.seen.join(" "), typeof again);
