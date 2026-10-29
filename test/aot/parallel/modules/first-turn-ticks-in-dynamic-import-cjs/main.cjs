// A CommonJS entry point calls `import()` on an ES module that imports node:fs: node:fs is loaded before the imported module is evaluated, so its promise jobs run ahead of its process.nextTick callbacks.
import("./imported.ts");
