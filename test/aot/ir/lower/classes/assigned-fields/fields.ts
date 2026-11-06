// RUN: lower
// CHECK-LABEL: function {{*}}name="C" {{*}}kind=BaseConstructor
// CHECK: [[allocated]] = NewObject {{*}}layout=[[layout]] @
// CHECK-NEXT: [[this]] = Convert [[allocated]] declared={type=[[layout]] flags=[IsFromCompiler]}
// CHECK: PrivateDefine [[this]], [[token]], [[token]] layout=[[layout]] @
// CHECK: [[undefined]] = Undefined
// CHECK: PrivateDefine [[this]], {{*}}, [[undefined]] layout=[[layout]] field=[[p]] @
// CHECK: = Call {{*}}calleeName="first"
// CHECK: PropSet [[this]], {{*}}key="q"
// CHECK: = CallDirect {{*}}function=[[initializer]]
// CHECK: = Call {{*}}calleeName="f"
// CHECK: function [[initializer]] {{*}}kind=Initializer
// CHECK: PropSet {{*}}key="a"
// CHECK: PrivateSet {{*}}layout=[[layout]] field=[[p]] @

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
