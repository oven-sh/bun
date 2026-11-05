// RUN: lower
// OPTIONS: builtin-modules

// `function f(a) { var a = "new"; return a; }` returns the new value.
declare const console: { log(...a: unknown[]): void };
function f(a: string) { var a = "new"; return a; }
console.log(f("old"));

// CHECK-LABEL: function {{*}}name="f"
