// RUN: lower
// CHECK-LABEL: function {{*}}kind=Initializer
// CHECK: [[kept]] = String string="Kept"
// CHECK-NEXT: = Builtin builtin=CompilerHelpersApplyClassDecorators
// CHECK-NEXT: = Call {{*}}, [[kept]],
// CHECK: [[marked]] = String string="Marked"
// CHECK-NEXT: = Builtin builtin=CompilerHelpersApplyClassDecorators
// CHECK-NEXT: = Call {{*}}, [[marked]],
// CHECK-LABEL: function {{*}}name="Kept" {{*}}kind=BaseConstructor
// CHECK-LABEL: function {{*}}name="Marked" {{*}}kind=BaseConstructor
// CHECK-NOT: name="Bare"

declare const d: any;

export class Holder {
  accessor Kept = @d class {};
  @d Marked = @d class {};
  accessor Bare = class {};
}
