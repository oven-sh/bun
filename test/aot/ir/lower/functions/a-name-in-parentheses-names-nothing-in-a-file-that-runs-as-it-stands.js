// RUN: lower
// CHECK-LABEL: function {{*}}name="plain"
// CHECK-NOT: function {{*}}name="
// CHECK: function [[unnamed]] module=

// FILE: a-name-in-parentheses-names-nothing-in-a-file-that-runs-as-it-stands.js
// @bun
// Nothing prints this file again, so the engine sees the parentheses, and a name in parentheses names no function.
let plain, parenthesized;
plain = function () {};
(parenthesized) = function () {};
console.log(plain.name, parenthesized.name);
