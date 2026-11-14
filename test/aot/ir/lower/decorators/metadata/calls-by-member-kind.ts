// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: = FinishClass
// CHECK: [[label]] = String string="design:type"
// CHECK: [[define]] = Builtin builtin=CompilerHelpersDefineMetadata
// CHECK: = Call [[define]], -, [[label]],
// CHECK: = String string="design:paramtypes"
// CHECK: = String string="design:returntype"
// CHECK: builtin=CompilerHelpersDecorateMethod
// CHECK: = String string="design:type"
// CHECK-NOT: string="design:
// CHECK: builtin=CompilerHelpersDecorateProperty
// CHECK: = String string="design:type"
// CHECK: = String string="design:paramtypes"
// CHECK-NOT: string="design:
// CHECK: builtin=CompilerHelpersDecorateMethod
// CHECK-NOT: string="design:type"
// CHECK: = String string="design:paramtypes"
// CHECK-NOT: string="design:
// CHECK: builtin=CompilerHelpersDecorateClass

declare const d: any;

@d
class C {
  constructor(a: string) {}
  @d m(a: string): number {
    return a.length;
  }
  @d p: boolean = true;
  @d get g(): Date {
    return new Date();
  }
}

export { C };
