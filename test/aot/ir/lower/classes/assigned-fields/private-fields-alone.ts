// RUN: lower
// CHECK-LABEL: function {{*}}name="C" {{*}}kind=BaseConstructor
// CHECK: [[allocated]] = NewObject
// CHECK-NEXT: [[this]] = Convert [[allocated]]
// CHECK-NEXT: = CallDirect [[this]] function=[[initializer]]
// CHECK: = Call {{*}}calleeName="first"
// CHECK: PropSet [[this]], {{*}}key="q"
// CHECK: = Call {{*}}calleeName="f"
// CHECK: function [[initializer]] {{*}}kind=Initializer
// CHECK: [[called]] = Call {{*}}calleeName="value"
// CHECK-NEXT: [[value]] = Convert [[called]]
// CHECK: PrivateDefine {{*}}, [[value]] layout={{*}}field=

// No plain field has a value, so the private field is not assigned in the constructor.
// RUN(STORES): lower
// STORES-NOT: PrivateSet
// STORES-NOT: key="b"

declare function first(): number;
declare function value(): number;
declare function f(): void;

export class C {
  b: unknown;
  #p = value();
  constructor(public q: number = first()) {
    f();
  }
}
