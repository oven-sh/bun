// Reference: bun build --compile
// The other way round: plain.mjs is an ES module by its name, which in `bun run` only the loader behind `require` asks; the package says CommonJS.
// An executable holds it as an ES module, as the bundle does. parallel-test-runs/a-module-by-its-name-in-a-commonjs-package holds the answer of a build without a bundle.
import "./plain.mjs";
const again = () => require("./plain.mjs");
console.log(globalThis.seen.join(" "), typeof again);
