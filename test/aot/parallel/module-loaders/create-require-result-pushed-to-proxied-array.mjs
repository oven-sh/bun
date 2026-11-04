// The function returned by createRequire() is stored where the compiler cannot follow it, read back, and called with a name built at run time.
import { createRequire } from "node:module";
const held = new Proxy([], {});
held.push(createRequire(import.meta.url));
console.log(Object.keys(held[0](["node:", "zlib"].join(""))).length > 1);
