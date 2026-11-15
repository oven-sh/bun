// RUN: lower
// OPTIONS: builtin-modules

// A closure in the default of a parameter does not see a function that the body declares.
declare const console: { log(...a: unknown[]): void };
function g() { return "outer"; }
console.log(((cb = () => g()) => { function g() { return "inner"; } return cb(); })());

// CHECK-LABEL: function {{*}}name="g"
// CHECK-LABEL: function {{*}}name="cb"
// CHECK-LABEL: function {{*}}name="g"
