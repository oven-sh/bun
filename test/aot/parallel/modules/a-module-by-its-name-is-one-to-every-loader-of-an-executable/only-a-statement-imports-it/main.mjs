// Reference: bun build --compile
// An executable holds plain.mjs as the ES module that it is by its name. `bun run` asks the package alone where a statement imports it, and runs it sloppy.
import "./plain.mjs";
console.log(globalThis.seen.join(" "));
