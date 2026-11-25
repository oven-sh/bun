import * as library from "node:assert/strict";

// Under a name that nobody knows, so every function of the module is compiled.
(globalThis as any)[`held ${process.argv.length}`] = library;
try {
  library.equal(1, "1" as any);
} catch (error) {
  console.log((error as any).code);
}
