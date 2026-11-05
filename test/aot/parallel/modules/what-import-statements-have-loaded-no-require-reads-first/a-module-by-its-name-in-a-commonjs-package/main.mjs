// The other way round: plain.mjs is an ES module by its name, which only the loader behind `require` asks; the package says CommonJS.
import "./plain.mjs";
const again = () => require("./plain.mjs");
console.log(globalThis.seen.join(" "), typeof again);
