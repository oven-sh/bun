// Reference: bun build --compile
import * as all from "./between.mjs";
console.log(globalThis.seen.join(" "), Object.keys(all).length);
