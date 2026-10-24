// A .cjs file is sloppy code however it is reached, as in Node. Plain Bun runs the imported one as strict code, so its line is stored. The required file is a further entry point: nothing follows a `createRequire` that comes out of `await import`.
await import("./aliases-its-arguments.cjs");
const { createRequire } = await import("node:module");
createRequire(import.meta.url)("./aliases-its-arguments-when-required.cjs");
