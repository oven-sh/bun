// RUN: lower
// CHECK-LABEL: function {{*}}name="C"{{*}}kind=BaseConstructor
// CHECK: [[instance]] = NewObject {{*}}layout=[[layout]]
// CHECK: = Convert [[instance]] declared={type=[[layout]] flags=[IsFromCompiler]}
// CHECK-LABEL: function {{*}}name="m"
// CHECK: thisType={type=[[layout]] site=w{{*}}}
// CHECK-LABEL: function {{*}}name="s"
// CHECK: thisType={type=function flags=[IsExpected]}

// RUN(INITIALIZER): lower
// INITIALIZER: function {{*}}kind=Initializer{{*}}thisType={type=L{{*}} flags=[IsFromCompiler]} results=

export class C {
  x = 1;
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
