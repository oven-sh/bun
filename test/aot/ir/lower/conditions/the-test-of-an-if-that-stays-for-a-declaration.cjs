// `bun run` prints an `if` whose branch never runs where a declaration in the branch must stay, so its test is read. Where nothing stays, or where it writes the test as a boolean, nothing of the test is read.
// RUN: lower
// CHECK-LABEL: function {{*}}name="stays"
// CHECK: [[read]] = CheckInitialized {{*}}name="late"
// CHECK-NEXT: = TypeOf [[read]]
// CHECK-LABEL: function {{*}}name="goes"
// CHECK-NOT: CheckInitialized
// CHECK-LABEL: function {{*}}name="written"
// CHECK-NOT: CheckInitialized
exports.stays = function stays() {
  if (typeof late) {} else { function inner() {} }
  let late = 1;
  return late;
};
exports.goes = function goes() {
  "use strict";
  if (typeof late) {} else { function inner() {} }
  let late = 1;
  return late;
};
exports.written = function written() {
  if (![late]) { function inner() {} }
  let late = 1;
  return late;
};
