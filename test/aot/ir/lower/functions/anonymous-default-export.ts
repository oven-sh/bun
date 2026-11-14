// No variable or property gives the declaration its name: it has `default` from the start, as a function that is written with a name has that one.
// RUN: lower
// CHECK: function {{*}}name="default"{{*}}flags=[IsChecked, HasExplicitName]

export default function () {}
