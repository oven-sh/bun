// RUN: lower
// CHECK-LABEL: function {{*}}name="add"
// CHECK: = NewRuntimeError runtimeError=PrivateAccessorWithoutSetter
// Where `++` or `--` has called the getter and finds no setter, JSC's message names the getter.
// CHECK-LABEL: function {{*}}name="increment"
// CHECK: = Call
// CHECK: = NewRuntimeError runtimeError=PrivateAccessorWithoutGetter
// CHECK-LABEL: function {{*}}name="storeIncrement"
// CHECK: = NewRuntimeError runtimeError=PrivateAccessorWithoutSetter

export class Counter {
  get #count() {
    return 1;
  }

  add() {
    this.#count += 1;
  }

  increment() {
    this.#count++;
  }

  storeIncrement(other) {
    this.#count = ++other;
  }
}

// A method has its body once reached code reads its name.
export function readsTheNames(o) { return [o.increment, o.storeIncrement]; }
