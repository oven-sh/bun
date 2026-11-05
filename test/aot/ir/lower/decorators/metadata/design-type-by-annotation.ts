// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: = FinishClass
// CHECK: [[string]] = PropGet {{*}}key="String" [isFreeName]
// CHECK: = Convert [[string]] declared={type=builtin(String) flags=[IsExpected]}
// CHECK: = String string="text"
// CHECK: [[array]] = PropGet {{*}}key="Array" [isFreeName]
// CHECK: = Convert [[array]] declared={type=builtin(Array) flags=[IsExpected]}
// CHECK: = String string="list"
// CHECK: [[object]] = PropGet {{*}}key="Object" [isFreeName]
// CHECK: = Convert [[object]] declared={type=builtin(Object) flags=[IsExpected]}
// CHECK: = String string="anything"
// CHECK: [[nothing]] = Undefined
// CHECK: [[define]] = Builtin builtin=CompilerHelpersDefineMetadata
// CHECK: = Call [[define]], -, {{*}}, [[nothing]] @
// CHECK: = String string="nothing"
// CHECK: = PropGet {{*}}key="BigInt" [isFreeName, isForTypeOf]
// CHECK: = TypeTest {{*}}testedType=undefined
// CHECK: = PropGet {{*}}key="Object" [isFreeName]
// CHECK: = PropGet {{*}}key="BigInt" [isFreeName]
// CHECK: = String string="big"
// CHECK: = PropGet {{*}}key="Symbol" [isFreeName, isForTypeOf]
// CHECK: = TypeTest {{*}}testedType=undefined
// CHECK: = PropGet {{*}}key="Object" [isFreeName]
// CHECK: = PropGet {{*}}key="Symbol" [isFreeName]
// CHECK: = String string="unique"
// CHECK-NOT: TypeTest
// CHECK: = PropGet {{*}}key="Object" [isFreeName]
// CHECK-NOT: TypeTest
// CHECK: = String string="either"
// CHECK: = PropGet {{*}}key="Shape" [isFreeName, isForTypeOf]
// CHECK: = TypeTest {{*}}testedType=undefined
// CHECK: = PropGet {{*}}key="Object" [isFreeName]
// CHECK: = String string="shape"

declare const d: any;

interface Shape {
  side: number;
}

export class C {
  @d text!: string;
  @d list!: number[];
  @d anything: any;
  @d nothing!: void;
  @d big!: bigint;
  @d unique!: symbol;
  @d either!: string | number;
  @d shape!: Shape;
}
