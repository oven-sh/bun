// A .cjs file is sloppy code however it is reached, as in Node. Plain Bun runs the imported one as strict code, so its line is stored.
await import("./aliases-its-arguments.cjs");
const { createRequire } = await import("node:module");
createRequire(import.meta.url)("./aliases-its-arguments-when-required.cjs");
/* Output:
imported 9 3 9,2,3 false
required 9 3 9,2,3 false
*/
