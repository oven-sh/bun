// A comment inside a tag names no factory.

// RUN: lower
// CHECK-LABEL: function {{*}}name="element"
// CHECK: calleeKey="createElement"
// CHECK-NOT: calleeName="h"

import * as React from "react";

function h(tag: unknown) {
  return tag;
}

export function element() {
  return [<a /* @jsx h */ />, h];
}
