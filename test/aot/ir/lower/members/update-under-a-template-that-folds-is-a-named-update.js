// A bundle that does not minify syntax prints a template as it is written, so JSC tests the object of an update under it ahead of the read, with a message of its own.
// The compiler knows the name all the same.
// RUN: lower
// CHECK-LABEL: function {{*}}name="computed"
// CHECK: = RequireObjectCoercible {{*}}nullishAccess=Update
// CHECK: = ElemGet
// CHECK-NOT: RequireObjectCoercible
// CHECK: ElemSet
// CHECK-LABEL: function {{*}}name="inATemplate"
// CHECK: = RequireObjectCoercible {{*}}nullishAccess=Update
// CHECK: = PropGet {{*}}key="nab"
// CHECK-NOT: RequireObjectCoercible
// CHECK: PropSet {{*}}key="nab"
// CHECK-LABEL: function {{*}}name="plain"
// CHECK: = RequireObjectCoercible {{*}}nullishAccess=Update
// CHECK: = PropGet {{*}}key="name"
// CHECK-NOT: RequireObjectCoercible
// CHECK: PropSet {{*}}key="name"
// CHECK-LABEL: function {{*}}name="written"
// CHECK-NOT: RequireObjectCoercible
// CHECK: = PropGet {{*}}key="name"
// CHECK-NOT: RequireObjectCoercible
// CHECK: PropSet {{*}}key="name"

export function computed(holder, free) {
  holder[`${free}`]++;
}

export function inATemplate(holder) {
  holder[`n${`a${"b"}`}`]++;
}

export function plain(holder) {
  holder[`name`]++;
}

export function written(holder) {
  holder["name"]++;
}
