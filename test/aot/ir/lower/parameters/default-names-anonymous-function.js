// RUN: lower
// CHECK: function {{*}}name="a"

// RUN(OWN): lower
// OWN: function {{*}}name="named"{{*}}HasExplicitName

// RUN(INFERRED): lower
// INFERRED-NOT: name="a"{{*}}HasExplicitName
// INFERRED-NOT: name="b"

export function f(a = function () {}, b = function named() {}) {}
