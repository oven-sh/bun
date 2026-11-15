// RUN: lower
// CHECK: function {{*}}name="default"

// RUN(BODY): lower
// BODY-LABEL: function {{*}}kind=Module
// BODY: [[closure]] = NewClosure
// BODY: PutModuleVariable [[closure]]
// BODY: Return

export default () => 1;
