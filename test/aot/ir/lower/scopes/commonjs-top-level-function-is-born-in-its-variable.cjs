// RUN: lower
// CHECK-LABEL: function {{*}}kind=CommonJsModule
// CHECK: = NewClosure function=
// CHECK-NOT: NewClosure
// CHECK: PropSet {{*}}key="a"
// CHECK-LABEL: function {{*}}name="b"
// CHECK-LABEL: function {{*}}flags=[IsSloppy] thisType
// CHECK-NOT: GlobalThis
// CHECK: [[b]] = GetModuleVariable variable=
// CHECK-NEXT: = Call [[b]] calleeName="b"

// RUN(RECORDS): link
// RECORDS: variable {{*}}name="b" {{*}}initialization=Function

// The body of the file runs once, so a function that it declares at its top is what its variable is born with, as in an ES module: nobody makes it, and nobody captures it.
function b() {}

exports.a = function () {
  return b();
};
