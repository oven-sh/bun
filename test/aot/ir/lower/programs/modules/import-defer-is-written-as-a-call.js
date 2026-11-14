// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: TS17012 3

// `import.defer(..)`: `bun run` reports each and runs nothing, and so does the build.
console.log("never printed");
const later = await import.defer("node:path");
console.log(typeof later.join);
function neverCalled() {
  return import.defer("node:fs", {});
}
if (false) import . defer("node:os");
