// RUN: lower
// CHECK: function {{*}}kind=CommonJsModule
// CHECK: [[head]] = NewObject
// CHECK: PutModuleVariable {{*}}variable=[[exports]]
// CHECK: PropSet {{*}}key="a"
// CHECK: PutModuleVariable {{*}}variable=[[exports]]
// CHECK: Return

// RUN(FIRST): lower
// FIRST-NOT: testedType=undefined
// FIRST-NOT: key="exports"
// FIRST-NOT: ModuleBuiltin

// `exports` is mentioned ahead of the store to `module.exports`, so the first object is made. The store is a store to the variable.
exports.a = 1;
module.exports = f;
function f() {}
