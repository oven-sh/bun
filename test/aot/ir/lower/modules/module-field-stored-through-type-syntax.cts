// RUN: lower
// CHECK: function {{*}}kind=CommonJsModule
// CHECK: [[stored]] = ModuleBuiltin builtin=ModuleObject
// CHECK: PropSet [[stored]], {{*}}key="id"
// CHECK: [[read]] = ModuleBuiltin builtin=ModuleObject
// CHECK-NEXT: = PropGet [[read]] key="id"

// RUN(RECORD): lower
// RECORD-NOT: string="."

// A store through a type assertion is a store: the field may hold something else than the record of the module says, so the read asks the object.
// @ts-nocheck
(module.id as any) = "x";
console.log(module.id);
