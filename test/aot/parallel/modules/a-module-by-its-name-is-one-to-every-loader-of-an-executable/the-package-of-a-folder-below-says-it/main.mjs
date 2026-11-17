// Reference: bun build --compile
import "./quiet-thing/index.mjs";
console.log(globalThis.seen.join(" "));
