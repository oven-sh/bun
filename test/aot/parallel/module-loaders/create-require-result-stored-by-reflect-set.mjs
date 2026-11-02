// The function returned by createRequire() is stored where the compiler cannot follow it, read back, and called with a name built at run time.
import { createRequire } from "node:module";
const held = new Proxy({}, {});
Reflect.set(held, "member", createRequire(import.meta.url));
console.log(Object.keys(Reflect.get(held, "member")(["node:", "zlib"].join(""))).length > 1);
