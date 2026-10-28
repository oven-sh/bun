// A CommonJS file may return at its top. The body of a namespace is no part of that: `bun run` reports a syntax error.
// @ts-nocheck
namespace Early {
  if (1) return;
}
console.log(typeof Early, typeof module);
