// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: [[this]] = Null
// CHECK-NEXT: PutModuleVariable [[this]] variable=
// CHECK-LABEL: function {{*}}name="arrow"{{*}}kind=Arrow
// CHECK: [[inherited]] = Null
// CHECK-NEXT: Return [[inherited]]

// RUN(MAIN): lower
// MAIN-NOT: HasThis
// MAIN-NOT: captures=
// MAIN-NOT: ToThis

// `bun run` has `null` for the `this` of a file with ES module syntax. The language says `undefined`.
export const top: unknown = this;

export const arrow = (): unknown => this;
