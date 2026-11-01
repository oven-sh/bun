// RUN: lower
// CHECK-LABEL: function {{*}}name="C" {{*}}kind=BaseConstructor
// CHECK: [[allocated]] = NewObject {{*}}layout=[[layout]] @
// CHECK-NEXT: [[this]] = Convert [[allocated]] declared={type=[[layout]] flags=[IsFromCompiler]}
// CHECK: PrivateDefine [[this]], [[token]], [[token]] layout=[[layout]] @
// CHECK: [[undefined]] = Undefined
// CHECK: PrivateDefine [[this]], {{*}}, [[undefined]] layout=[[layout]] field=[[p]] @
// CHECK: = Call {{*}}calleeName="first"
// CHECK: PropSet [[this]], {{*}}key="q"
// CHECK: PropSet [[this]], {{*}}key="a"
// CHECK: PrivateSet [[this]], {{*}}layout=[[layout]] field=[[p]] @
// CHECK: = Call {{*}}calleeName="f"

// The values of the fields are code of the constructor.
// RUN(FUNCTIONS): lower
// FUNCTIONS-NOT: kind=Initializer

// RUN(UNINITIALIZED): lower
// UNINITIALIZED-NOT: key="b"

// RUN(DEFINITIONS): lower
// DEFINITIONS-NOT: PropDefine

declare function first(): number;
declare function f(): void;

export class C {
  a = 1;
  b: unknown;
  #p = 2;
  constructor(public q: number = first()) {
    f();
  }
}
