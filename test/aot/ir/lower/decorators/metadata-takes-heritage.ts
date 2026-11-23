// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: = ResolveHeritage [[base]]
// CHECK: [[createDerived]] = Builtin builtin=CompilerHelpersCreateDecoratorMetadata
// CHECK: = Call [[createDerived]], -, [[base]] @
// CHECK: = FinishClass
// CHECK: [[nothing]] = Undefined
// CHECK-NEXT: [[createBase]] = Builtin builtin=CompilerHelpersCreateDecoratorMetadata
// CHECK: = Call [[createBase]], -, [[nothing]] @

declare const d: any;

class B {}

@d
class Derived extends B {}

@d
class Base {}

export { Base, Derived };
