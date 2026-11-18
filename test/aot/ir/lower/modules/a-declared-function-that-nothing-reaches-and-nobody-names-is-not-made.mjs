// RUN: link
// CHECK: function {{*}}module=m0 kind=Module
// CHECK-NEXT: b0():
// CHECK-NEXT: Undefined
// CHECK-NEXT: Return
// CHECK: function {{*}}name="evaluate"
// CHECK-NEXT: b0
// CHECK-NEXT: NewRuntimeError runtimeError=OmittedFromExecutable name="evaluate"

// FILE: main.mjs
// Nobody imports `evaluate` and nobody names it in lib.mjs, so its body is left out: what stands for it throws. The tables of the file still name the function, so it is declared. But no
// function object is made of it at the head of the module: a closure over the body that throws made the flow take that body for reachable, and the executable kept what compiled code calls for
// errors and for modules that throw.
import { double } from "./lib.mjs";
console.log(double(21));

// FILE: lib.mjs
export function double(x) {
  return x * 2;
}
export function evaluate(text) {
  return (0, eval)(text);
}
