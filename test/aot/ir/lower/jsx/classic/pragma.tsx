// RUN: lower
// CHECK-LABEL: function {{*}}name="element"
// CHECK-NOT: key="createElement"
// CHECK: [[h]] = GetModuleVariable
// CHECK: [[tag]] = String string="a"
// CHECK: [[props]] = Null
// CHECK: = Call [[h]], -, [[tag]], [[props]] calleeName="h"

/** @jsx h */

function h(tag: unknown, props: unknown) {
  return null;
}

export function element() {
  return <a />;
}
