// Reference: bun build --compile
import "./plain.mjs";
const again = require("./plain.mjs");
console.log(globalThis.seen.join(" "), typeof again);
