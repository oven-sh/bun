// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: TS1497 1
// DIAGNOSTIC: TS18016 1
// DIAGNOSTIC: TS2335 1
// DIAGNOSTIC: TS2337 1
// DIAGNOSTIC: TS2660 1
// DIAGNOSTIC: TS2815 1

// Plain Bun rejects every line below a `@ts-ignore` before it runs anything, so the comment does not suppress these early errors, which the checker reports while it types expressions.
declare const anything: any;
declare const makeDecorator: any;
function makeFields() { return class {
  // @ts-ignore
  field = arguments;
}; }
class NoBase { constructor() {
  // @ts-ignore
  super();
} }
function reads() {
  // @ts-ignore
  return super.member;
}
function calls() {
  // @ts-ignore
  super();
}
// @ts-ignore
console.log(anything.#name);
// @ts-ignore
@makeDecorator()()
class Decorated {}
console.log(makeFields, NoBase, reads, calls, Decorated);
