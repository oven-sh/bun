// RUN: lower
// CHECK-LABEL: function {{*}}name="Foo"
// CHECK: thisType={type=L{{*}} flags=[IsExpected]} results=

export function Foo() {
  this.x = 1;
}
