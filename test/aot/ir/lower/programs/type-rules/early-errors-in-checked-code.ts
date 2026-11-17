// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: TS1102 1
// DIAGNOSTIC: TS1262 1
// DIAGNOSTIC: TS2699 1

// Plain Bun rejects each of these while parsing. TypeScript accepts the first, and `@ts-ignore` hides its own errors for the other two, so the ECMAScript early errors stop the build.
function nested(await: number) { return 1; }
let held = 1;
// @ts-ignore
delete (held);
class Named {
  // @ts-ignore
  static prototype = 1;
}
console.log(nested, held, Named);
export {};
