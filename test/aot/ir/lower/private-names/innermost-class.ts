// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: = NewClass {{*}}layout=[[outer]]
// CHECK-LABEL: function {{*}}name="readOuter"
// CHECK: = PrivateGet {{*}}layout=[[outer]] field=1 @
// CHECK-LABEL: function {{*}}kind=Initializer{{*}}thisType={type=function flags=[IsFromCompiler]}
// CHECK: = NewClass {{*}}layout=[[inner]]
// CHECK-LABEL: function {{*}}name="readInner"
// CHECK: = PrivateGet {{*}}layout=[[inner]] field=1 @

// RUN(DISTINCT): lower
// DISTINCT: = NewClass {{*}}layout=[[outer]]
// DISTINCT: function {{*}}name="readInner"
// DISTINCT-NOT: layout=[[outer]]

export class Outer {
  #x = 1;
  static readOuter(o: Outer) {
    return o.#x;
  }
  static Inner = class Inner {
    #x = 2;
    static readInner(o: Inner) {
      return o.#x;
    }
  };
}
