// RUN: lower
// CHECK-LABEL: function {{*}}name="C"{{*}}kind=BaseConstructor
// CHECK: [[instance]] = NewObject {{*}}layout=[[layout]]
// CHECK: = Convert [[instance]] declared={type=[[layout]]}
// CHECK-LABEL: function {{*}}name="m"
// CHECK: thisType={type=[[layout]]}
// CHECK-LABEL: function {{*}}name="s"
// CHECK: thisType={type=function flags=[IsExpected]}

// RUN(INITIALIZER): lower
// INITIALIZER: function {{*}}kind=Initializer{{*}}thisType={type=L{{*}}} results=

export class C {
  x = Object.keys(this).length;
  constructor() {
    this.x = 2;
  }
  m() {
    return this.x;
  }
  static s() {
    return this;
  }
}

// A method has its body once reached code reads its name.
export function readsTheNames(o: any) { return [o.m]; }
