// RUN: lower
// CHECK-LABEL: function {{*}}kind=CommonJsModule
// CHECK-NOT: = NewObject
// CHECK: [[a]] = Convert {{*}}declared={type=1 flags=[IsExpected]}
// CHECK-NOT: = NewObject
// CHECK: [[method]] = NewClosure [[a]] function=
// CHECK-NEXT: DefineMethod {{*}}, [[method]] {{*}}key="m"
// CHECK-NOT: = NewObject
// CHECK-LABEL: function {{*}}kind=BaseConstructor
// CHECK-LABEL: function {{*}}name="m"
// CHECK: captures=[{type=1 flags=[IsExpected]}] thisType
// CHECK: b0([[copy]]: 1):

// RUN(STORAGE): lower
// STORAGE-NOT: ModuleVariable
// STORAGE-NOT: env L
// STORAGE: PutModuleVariable [[class]] variable=
// STORAGE-NOT: ModuleVariable
// STORAGE-NOT: env L

// The one variable of the module holds what it exports.
const a = 1;

module.exports = class {
  m() {
    return a;
  }
};
