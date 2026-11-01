// A timer, which is no promise job, calls `import()` on a module that imports node:fs, in a program that has not read process.nextTick before: node:fs is loaded in an earlier job than the one that evaluates the imported module.
setTimeout(() => {
  import("./imported.ts");
}, 1);
export {};
