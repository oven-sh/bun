// Two modules import each other, and the one that was entered first throws behind the other's end. A third module, which imports the one that ended, is imported later: it does not run, and its import() rejects with what was thrown.
await import("./first.mjs").catch(error => console.log("import(first) rejects", error));
await import("./later.mjs").then(
  () => console.log("import(later) resolves"),
  error => console.log("import(later) rejects", error),
);
