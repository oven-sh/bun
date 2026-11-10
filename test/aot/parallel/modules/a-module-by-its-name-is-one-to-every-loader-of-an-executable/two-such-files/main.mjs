// Reference: bun build --compile
import "./one.mjs";
import "./other.mjs";
console.log(globalThis.seen.join(" "));
