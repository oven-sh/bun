// A CommonJS module written like the `debug` package: a setup function that copies properties onto the function it exports.
import createDebug from "./cjs_debug_index.js";
const d = (createDebug as any)("x");
console.log(d("a", 1), (createDebug as any).namespaces, Object.keys(createDebug as any).join());
