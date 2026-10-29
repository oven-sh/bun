// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: TS1108 1

// A CommonJS file may return at its top. The body of a namespace is no part of that: `bun run` reports a syntax error.
// @ts-nocheck
namespace Early {
  if (1) return;
}
console.log(typeof Early, typeof module);
