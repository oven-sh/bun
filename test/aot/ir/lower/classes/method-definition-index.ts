// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: [[outer]] = NewClass [[outerConstructor]] layout=
// CHECK: DefineMethod [[outer]], {{*}}layout=[[outerLayout]] key="z"
// CHECK: DefineMethod [[outer]], {{*}}layout=[[outerLayout]] side=Static index=1 key="s"
// CHECK: [[inner]] = NewClass [[innerConstructor]] layout=
// CHECK: DefineMethod [[inner]], {{*}}layout=[[innerLayout]] key="first"
// CHECK: DefineMethod [[inner]], {{*}}layout=[[innerLayout]] index=1 key="second"
// CHECK: DefineMethod [[outer]], {{*}}layout=[[outerLayout]] index=2 @
// CHECK: DefineMethod [[outer]], {{*}}layout=[[outerLayout]] index=3 key="a"
// CHECK: = FinishClass [[outer]]

// RUN(PIECES): lower
// PIECES-COUNT-6: DefineMethod
// PIECES-NOT: DefineMethod

export class Outer {
  z() {}
  field = 1;
  static s() {}
  #hidden() {}
  static count = 0;
  [class {
    first() {}
    second() {}
  }.name]() {}
  a() {
    this.#hidden();
  }
}
