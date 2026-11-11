// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK-NOT: key="Object"
// CHECK: [[define]] = Builtin builtin=CompilerHelpersDefineMetadata
// CHECK: = Call [[define]],
// CHECK-NOT: key="Object"
// CHECK: Return

// RUN(CAPTURED): lower
// CAPTURED-LABEL: function {{*}}name="create"
// CAPTURED-NOT: key="Object"
// CAPTURED: [[type]] = CheckInitialized {{*}}name="Object"
// CAPTURED: [[define]] = Builtin builtin=CompilerHelpersDefineMetadata
// CAPTURED: = Call [[define]], -, {{*}}, [[type]] @
// CAPTURED-NOT: key="Object"
// CAPTURED: Return

declare const d: any;

class Object {}

export class C {
  @d p: any;
}

export function create() {
  class Inner {
    @d q: any;
  }
  return Inner;
}
