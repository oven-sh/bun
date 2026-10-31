// RUN: lower
// CHECK: function {{*}}kind=CommonJsModule
// CHECK-NEXT: b0():
// CHECK: = ModuleBuiltin builtin=ModuleRequire
// CHECK: = ModuleBuiltin builtin=ModuleObject
// CHECK: CallDirect {{*}}function=[[wrapped]]
// CHECK: Return

// RUN(WRAPPED): link
// WRAPPED: function {{*}}flags=[{{*}}HasThis{{*}}parameters=[{type=anything}, {type=anything}, {type=anything}, {type=anything}, {type=anything}]
// WRAPPED: [[object]] = Data
// WRAPPED: PropSet {{*}}key="a"
// WRAPPED: Return

// RUN(NAMES): lower
// NAMES-NOT: GlobalThis
// NAMES-NOT: key="module"

// A store to one of the five names: the text of the file becomes a function of five parameters, as it was written, and the body of the module calls it with the five values.
exports = {};
exports.a = 1;
module = null;
