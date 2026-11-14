// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: TS1104 1

// Folding removes the block, but plain Bun rejects the `continue` in it while parsing, so the build stops too.
if (false) { continue; }
console.log("never printed");
