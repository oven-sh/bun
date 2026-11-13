// The export gives a function expression its name, as a variable does.
// RUN: lower
// CHECK: function {{*}}name="default"{{*}}flags=[IsChecked]

// RUN(INFERRED): lower
// INFERRED-NOT: HasExplicitName

export default (function () {});
