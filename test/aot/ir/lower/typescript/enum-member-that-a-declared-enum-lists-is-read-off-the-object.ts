// `declare enum` makes no member, though an enum of its name beside it makes the object: `bun run` reads `Mode.Fast` off the object and finds nothing. No branch is decided by the value that the declaration lists.
// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: = PropGet {{*}}key="Fast"
// CHECK: Branch
// CHECK: = String string="as listed"
// CHECK: = String string="read off the object"
// CHECK: = PropGet {{*}}key="Fast"
// CHECK: PropSet {{*}}key="Next"

declare function use(...values: unknown[]): void;

declare enum Mode {
  Off,
  Fast,
}

enum Mode {
  Slow = 2,
}

if (Mode.Fast === 1) use("as listed");
else use("read off the object");

enum Mode {
  Next = Mode.Fast + 1,
}
