// RUN: lower
// CHECK: function {{*}}kind=CommonJsModule flags=[IsSloppy]
// CHECK-NEXT: b0():
// CHECK: = NewObject layout=[[layout]]
// CHECK: PutModuleVariable {{*}}variable=[[held]]
// CHECK-NEXT: PutModuleVariable {{*}}variable=[[exports]]
// CHECK-NEXT: = GetModuleVariable variable=[[exports]]
// CHECK: PropSet {{*}}key="a"
// CHECK: [[module]] = ModuleBuiltin builtin=ModuleObject module=m
// CHECK-NEXT: [[object]] = PropGet [[module]] key="exports"
// CHECK: = Add
// CHECK: PropSet [[object]], {{*}}key="b"

// RUN(NOWHERE): lower
// NOWHERE-NOT: builtin(ModuleObjectExports)
// NOWHERE-NOT: parameters=[

// RUN(INNER): lower
// INNER-LABEL: function {{*}}name="load"
// INNER-NOT: captures=[
// INNER: [[require]] = ModuleBuiltin builtin=ModuleRequire module=m
// INNER: [[module]] = ModuleBuiltin builtin=ModuleObject module=m
// INNER: [[read]] = GetModuleVariable variable=g
// INNER-NEXT: [[exports]] = Convert [[read]]
// INNER: = NewArray [[require]], [[module]], [[exports]]
// INNER: Return

// The five names of a CommonJS module are no parameters: `exports` is a variable of the module, and so is `module.exports` in a file that hands `module` to nobody (this one does, so it asks the object), `__filename` and `__dirname` are constants of its record, and `require` and `module` as values are operations that make the object when the first of them runs. A function inside captures none of them.
exports.a = 1;
module.exports.b = __filename + __dirname;
exports.load = function load() {
  return [require, module, exports];
};
