// RUN: lower
// OPTIONS: builtin-modules

// A closure in a computed member name does not see a function that the member's body declares.
declare const console: { log(...a: unknown[]): void };
function k() { return "outer"; }
let g = () => "";
class C { [(g = () => k(), "m")]() { function k() { return "inner"; } } }
console.log(g());

// CHECK-LABEL: function {{*}}name="k"
// CHECK-LABEL: function {{*}}name="g"
// CHECK-LABEL: function {{*}}name="C"
// CHECK-LABEL: function {{*}}name="g"
// CHECK-LABEL: function {{*}}name="k"
