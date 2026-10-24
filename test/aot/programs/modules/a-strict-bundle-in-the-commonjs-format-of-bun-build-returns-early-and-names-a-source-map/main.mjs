// A strict bundle in the commonjs format of bun build returns early and names a source map.
import m from "./pkg/index.js";
console.log(JSON.stringify(m));
