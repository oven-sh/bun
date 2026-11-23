// RUN: lower
// CHECK-LABEL: function {{*}}kind=CommonJsModule flags=[IsSloppy] thisType
// CHECK: [[new]] = NewObject layout=[[layout]]
// CHECK-NEXT: [[this]] = FinishObject [[new]]
// CHECK-NEXT: PutModuleVariable [[this]] variable=[[variable]]
// CHECK-NEXT: [[read]] = GetModuleVariable variable=[[variable]]
// CHECK-NEXT: [[exports]] = Convert [[read]] declared={type=[[layout]] flags=[IsExpected]}
// CHECK: PropSet [[exports]], {{*}}key="a" mode=Sloppy
// CHECK: PropSet [[this]], {{*}}key="b" mode=Sloppy
// CHECK: = NewClosure [[this]] function=

// RUN(GLOBAL): lower
// GLOBAL-NOT: GlobalThis
// GLOBAL-NOT: ToThis

// RUN(CHECKER): lower
// CHECKER-NOT: type=undefined flags=[IsExpected]

// `this` of a CommonJS module is the exports object that the module starts with, also in an arrow function. The checker takes it for `undefined`, which is expected nowhere.
exports.a = 1;
this.b = 2;
exports.read = () => this.a;
