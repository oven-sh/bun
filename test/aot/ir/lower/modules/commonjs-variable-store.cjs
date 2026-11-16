// RUN: lower
// CHECK: function {{*}}kind=CommonJsModule
// CHECK-NEXT: b0():
// CHECK-NOT: ModuleBuiltin
// CHECK: CallDirect {{*}}function=[[wrapped]]
// CHECK: Return

// RUN(WRAPPED): link
// WRAPPED: function {{*}}flags=[{{*}}HasThis{{*}}parameters=[{type=anything}, {type=anything}, {type=anything}, {type=anything}, {type=anything}]
// WRAPPED-NOT: ModuleRequire
// WRAPPED: = ModuleBuiltin builtin=ModuleObject
// WRAPPED: [[object]] = Data
// WRAPPED: PropSet {{*}}key="a"
// WRAPPED: Return

// RUN(NAMES): lower
// NAMES-NOT: GlobalThis
// NAMES-NOT: key="module"

// A store to one of the five names: the text of the file becomes a function of five parameters, as it was written. The file has no `arguments` object, so the body of the module hands it `exports` alone:
// `module` and `require` are operands of no call. The function makes at its own entry what a name that is stored to begins with, and nothing for a name that the text does not hold.
exports = {};
exports.a = 1;
module = null;
