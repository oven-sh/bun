// A test run writes every place that a test may replace as a read, so that a test can replace it. `Symbol` and `Symbol.for` are left out: the engine takes `const state = Symbol("state")` at the top of
// a module for a key that is made once only where the callee is the built-in itself, and every `this[state]` of the library and of the program hangs on that. No file of the tests spells a store to them here,
// so the build folds by them, and says so: the place stays locked in this run.
// RUN: link
// OPTIONS: runs-tests
// CHECK: = Builtin builtin=Symbol
// CHECK: = Call {{*}}calleeName="Symbol"

// FILE: main.ts
const state = Symbol("state");
export class Counter {
  [state] = 0;
  bump() {
    return ++this[state];
  }
}
console.log(new Counter().bump());
