import * as library from "node:assert";

// Under a name that nobody knows, so every function of the module is compiled.
(globalThis as any)[`held ${process.argv.length}`] = library;
library.deepStrictEqual({ a: [1] }, { a: [1] });
try {
  library.strictEqual(1, 2);
} catch (error) {
  console.log((error as any).code);
}
