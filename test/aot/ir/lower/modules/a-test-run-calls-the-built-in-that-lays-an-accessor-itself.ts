// A test run writes every place that a test may replace as a read. `Object.defineProperty` and `Object.defineProperties` are left out, as `Symbol` is: the engine sees an accessor that a file lays on a prototype
// only where the callee is the built-in itself. Where it does not see it, a store under that name counts as a field of the object. No file of the tests spells a store to them here, so the build folds by them,
// and says so: the place stays locked in this run.
// RUN: link
// OPTIONS: runs-tests
// CHECK: = Builtin builtin=ObjectDefineProperty
// CHECK: = Call {{*}}calleeName="Object.defineProperty"

// FILE: main.ts
export function Gauge(this: any) {
  this.level = 0;
}
Object.defineProperty(Gauge.prototype, "double", {
  get() {
    return this.level * 2;
  },
  configurable: true,
});
console.log(new (Gauge as any)().double);
