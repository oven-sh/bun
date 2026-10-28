// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: [[this]] = Undefined
// CHECK-NEXT: PutModuleVariable [[this]] variable=
// CHECK-LABEL: function {{*}}name="arrow"{{*}}kind=Arrow
// CHECK: [[inherited]] = Undefined
// CHECK-NEXT: Return [[inherited]]

// RUN(ENTRY): lower
// ENTRY-NOT: HasThis
// ENTRY-NOT: captures=
// ENTRY-NOT: ToThis

export const top: unknown = this;

export const arrow = (): unknown => this;
