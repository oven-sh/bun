// The function returned by createRequire() is stored where the compiler cannot follow it, read back, and called with a name built at run time.
import { createRequire } from "node:module";
const held = new Proxy(new Proxy({}, {}), {});
held.member = createRequire(import.meta.url);
const { member } = held;
console.log(Object.keys(member(["node:", "zlib"].join(""))).length > 1);
