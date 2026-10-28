// Two .cjs files in which nothing names `module`, `exports` or `require`: one is imported, one is required. A .cjs file is sloppy code however it is reached, as in Node: `arguments` aliases the parameters and `this` of a plain call is the global object.
// Plain Bun runs the imported one as strict code, so its line is stored.
import { createRequire } from "node:module";
await import("./aliases-its-arguments.cjs");
createRequire(import.meta.url)("./aliases-its-arguments-when-required.cjs");
