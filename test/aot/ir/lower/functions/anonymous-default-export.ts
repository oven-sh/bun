// RUN: lower
// CHECK: function {{*}}name="default"{{*}}flags=[IsChecked]

// RUN(INFERRED): lower
// INFERRED-NOT: HasExplicitName

export default function () {}
