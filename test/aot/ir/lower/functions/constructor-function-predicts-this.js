// RUN: link
// CHECK: layout [[layout]] kind=Instance name="P" module=[[entry]] {{*}}flags=[IsConstructorFunction]
// CHECK: module [[entry]] path="{{*}}constructor-function-predicts-this"
// CHECK: function [[p]] name="P" module=[[entry]] {{*}}flags=[HasThis, {{*}}thisType={type=[[layout]] flags=[IsExpected]}
// CHECK: function [[q]] name="q" module=[[entry]] {{*}}flags=[HasThis, {{*}}thisType={type=anything}

// RUN(OTHER): link
// OTHER-NOT: layout [[other]] kind=Instance name="q"

export function P(x) {
  this.x = x;
}

export function q() {
  return this;
}
