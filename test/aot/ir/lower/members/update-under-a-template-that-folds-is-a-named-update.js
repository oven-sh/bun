// `bun run` prints a text for a template whose holes are constants, so an update under it is an update under a name: no test of the object ahead of the read.
// This driver folds as under --minify-syntax. Without the flag: update_under_a_key_that_bun_run_folds_has_the_error_of_its_read in src/aot/lower/member.rs.
// RUN: lower
// CHECK-LABEL: function {{*}}name="computed"
// CHECK: = RequireObjectCoercible {{*}}nullishAccess=Update
// CHECK: = ElemGet
// CHECK-NOT: RequireObjectCoercible
// CHECK: ElemSet
// CHECK-LABEL: function {{*}}name="inATemplate"
// CHECK-NOT: RequireObjectCoercible
// CHECK: = PropGet {{*}}key="nab"
// CHECK-NOT: RequireObjectCoercible
// CHECK: PropSet {{*}}key="nab"
// CHECK-LABEL: function {{*}}name="plain"
// CHECK-NOT: RequireObjectCoercible
// CHECK: = PropGet {{*}}key="name"
// CHECK-NOT: RequireObjectCoercible
// CHECK: PropSet {{*}}key="name"
// CHECK-LABEL: function {{*}}name="withANumber"
// CHECK-NOT: RequireObjectCoercible
// CHECK: = PropGet {{*}}key="n1"
// CHECK-NOT: RequireObjectCoercible
// CHECK: PropSet {{*}}key="n1"
// CHECK-LABEL: function {{*}}name="withAText"
// CHECK-NOT: RequireObjectCoercible
// CHECK: = PropGet {{*}}key="name"
// CHECK-NOT: RequireObjectCoercible
// CHECK: PropSet {{*}}key="name"
// CHECK-LABEL: function {{*}}name="withATextBehind"
// CHECK-NOT: RequireObjectCoercible
// CHECK: = PropGet {{*}}key="abc"
// CHECK-NOT: RequireObjectCoercible
// CHECK: PropSet {{*}}key="abc"
// CHECK-LABEL: function {{*}}name="withNull"
// CHECK-NOT: RequireObjectCoercible
// CHECK: = PropGet {{*}}key="nnull"
// CHECK-NOT: RequireObjectCoercible
// CHECK: PropSet {{*}}key="nnull"

export function computed(holder, free) {
  holder[`${free}`]++;
}

export function inATemplate(holder) {
  holder[`n${`a${"b"}`}`]++;
}

export function plain(holder) {
  holder[`name`]++;
}

export function withANumber(holder) {
  holder[`n${1}`] += 1;
}

export function withAText(holder) {
  holder[`na${"me"}`]++;
}

export function withATextBehind(holder) {
  holder[`a${"b"}` + "c"]++;
}

export function withNull(holder) {
  holder[`n${null}`] ||= 1;
}
