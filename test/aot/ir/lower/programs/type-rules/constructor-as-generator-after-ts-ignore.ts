// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: TS1368 1

// Plain Bun rejects an instance generator named `constructor` while parsing, so `@ts-ignore` does not suppress the error in a compiled file.
class A {
  // @ts-ignore
  *constructor() {}
}
console.log(typeof A);
