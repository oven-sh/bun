await import("./middle.mjs");
const again = require("./middle.mjs");
console.log(globalThis.seen.join(" "), typeof again);
