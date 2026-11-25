// RUN: lower
// CHECK-LABEL: function {{*}}name="sloppy"
// CHECK-NOT: NewRuntimeError
// CHECK-NOT: Throw
// CHECK: Return
// CHECK-LABEL: function {{*}}name="withDirective"
// CHECK: [[refused]] = NewRuntimeError runtimeError=ConstantAssignment name="withDirective"
// CHECK-NEXT: Throw [[refused]]
// CHECK-LABEL: function {{*}}name="strict"
// CHECK: [[error]] = NewRuntimeError runtimeError=ConstantAssignment name="strict"
// CHECK-NEXT: Throw [[error]]

exports.sloppy = function sloppy() {
  sloppy = 1;
};

exports.withDirective = function withDirective() {
  "use strict";
  withDirective = 1;
};

class Holder {
  static create() {
    return function strict() {
      strict = 1;
    };
  }
}

exports.strict = Holder.create();
