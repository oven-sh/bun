// RUN: lower
// CHECK-LABEL: function {{*}}name="A" {{*}}kind=BaseConstructor flags=[HasNewTarget,
// CHECK: [[allocated]] = NewObject {{*}}layout=[[layout]] @
// CHECK-NEXT: [[base]] = Convert [[allocated]] declared={type=[[layout]] flags=[IsFromCompiler]}
// CHECK: = CallDirect
// CHECK-NOT: TypeTest
// CHECK: Return [[base]]
// CHECK-LABEL: function {{*}}name="B" {{*}}kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee,
// CHECK: [[parent]] = GetSuperBase [[callee]] @
// CHECK: [[constructed]] = SuperConstructList [[parent]], [[newTarget]], [[arguments]] layout=[[derivedLayout]] @
// CHECK-NEXT: [[derived]] = Convert [[constructed]] declared={type=[[derivedLayout]] flags=[IsFromCompiler]}
// CHECK: = CallDirect [[derived]] function=
// CHECK-NOT: TypeTest
// CHECK: Return [[derived]]

export class A {
  x = 1;
}

export class B extends A {
  y = 2;
}
