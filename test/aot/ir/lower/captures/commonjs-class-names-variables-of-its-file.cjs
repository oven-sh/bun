// RUN: lower
// CHECK-LABEL: function {{*}}kind=CommonJsModule
// CHECK-NOT: = NewObject
// CHECK: [[a]] = PropGet {{*}}key="length"
// CHECK-NEXT: PutModuleVariable [[a]] variable=[[held]]
// CHECK: = NewClass
// CHECK: [[method]] = NewClosure function=
// CHECK-NEXT: DefineMethod {{*}}, [[method]] {{*}}key="m"
// CHECK-NOT: = NewObject
// CHECK-LABEL: function {{*}}kind=BaseConstructor
// CHECK-LABEL: function {{*}}name="m"{{*}}flags=[HasExplicitName] thisType
// CHECK: = GetModuleVariable variable=[[held]]

// RUN(STORAGE): lower
// STORAGE-NOT: env L

// The body of the file runs once: what it declares at its top is a variable of the module, and a method of a class there captures nothing.
const a = process.argv.length;

module.exports = class {
  m() {
    return a;
  }
};

// A method has its body once reached code reads its name.
module.exports.readsTheNames = function (o) { return [o.m]; };
