// RUN: lower
// CHECK: function {{*}}kind=CommonJsModule
// CHECK: [[nothing]] = Undefined
// CHECK: Branch {{*}}notTaken [[join]]([[nothing]])
// CHECK: [[module]] = ModuleBuiltin builtin=ModuleObject
// CHECK-NEXT: Jump -> next [[join]]([[module]])
// CHECK-NEXT: [[join]]([[held]]):
// CHECK: = TypeTest [[held]] testedType=undefined|null
// CHECK: = PropGet {{*}}key="exports"
// CHECK: = TypeTest [[held]] testedType=undefined|null
// CHECK: = PropGet {{*}}key="id"

// RUN(RECORD): lower
// RECORD-NOT: string="."
// RECORD-COUNT-1: ModuleBuiltin

// A `var` is undefined until its line has run. What is read off it is read off what it holds then: neither the record of the module nor its object answers in its place.
if (process.argv.length > 40) {
  var mo = module;
}
console.log(typeof mo?.exports, typeof mo?.id);
