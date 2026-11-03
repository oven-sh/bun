// RUN: lower
// CHECK-LABEL: function {{*}}name="initializer"
// CHECK: = Call
// CHECK: = ForInOpen
// CHECK-NOT: = Call
// CHECK-LABEL: function {{*}}name="plain"
// CHECK-NOT: = Call

function initializer(object, first) {
  for (var key = first() in object) {
  }
  return key;
}

function plain(object) {
  for (var key in object) {
  }
  return key;
}

initializer({}, () => "a");
plain({});
