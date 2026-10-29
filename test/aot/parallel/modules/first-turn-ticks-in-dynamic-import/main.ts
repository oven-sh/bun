// `import()` of a module that imports node:fs, in a program that has not read process.nextTick before: node:fs is loaded before the imported module is evaluated.
await import("./imported.ts");
export {};
