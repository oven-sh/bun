// RUN: lower
// DIAGNOSTIC: TS100302 2
// CHECK-LABEL: function {{*}}name="read"
// CHECK: = PropGet {{*}}key="arguments"
// CHECK: = PropGet {{*}}key="caller"
// CHECK: = PropGet {{*}}key="arguments"

function f() {}

const o = { arguments: 1 };

export function read() {
  f.arguments;
  f.caller;
  return o.arguments;
}
