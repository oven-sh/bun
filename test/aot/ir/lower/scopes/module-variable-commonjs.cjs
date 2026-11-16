// RUN: lower
// CHECK-LABEL: function {{*}}kind=CommonJsModule
// CHECK-NOT: = NewObject
// CHECK: PutModuleVariable {{*}}variable=[[n]]
// CHECK: [[inc]] = NewClosure function=
// CHECK-NEXT: PutModuleVariable [[inc]] variable=
// CHECK-LABEL: function {{*}}name="inc"{{*}}flags=[IsSloppy, HasExplicitName] thisType
// CHECK: = GetModuleVariable variable=[[n]]
// CHECK: PutModuleVariable {{*}}variable=[[n]]

// RUN(ENVIRONMENTS): lower
// ENVIRONMENTS-NOT: EnvironmentField

// RUN(RECORDS): link
// RECORDS: variable {{*}}name="n"

// The body of the file runs once, so what it declares at its top is a variable of the module, as in an ES module: the function captures nothing.
let n = 0;

module.exports = function inc() {
  n++;
};
