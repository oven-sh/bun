// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: = FinishClass
// CHECK: = String string="sm"
// CHECK: = String string="m"
// CHECK: = String string="sf"
// CHECK: = String string="f"
// CHECK: builtin=CompilerHelpersSetDecoratorMetadata

declare const d: any;

export class C {
  @d f = 1;
  @d static sf = 2;
  @d m() {}
  @d static sm() {}
}
