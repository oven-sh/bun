// A read of a member is its value only where Bun's transpiler has the value there. It follows no name in brackets that is not ASCII and no optional link. The length of a literal is a value, as under `bun run`.
// RUN: lower
// CHECK-LABEL: function {{*}}name="afterOtherName"
// CHECK: = PropGet {{*}}key="Next"
// CHECK-LABEL: function {{*}}name="fromLength"
// CHECK-NOT: = PropGet {{*}}key="Length"
// CHECK: = Integer integer=4 @
// CHECK-LABEL: function {{*}}name="fromOtherName"
// CHECK: = PropGet {{*}}key="FromOtherName"
// CHECK-LABEL: function {{*}}name="inCase"
// CHECK-NOT: Switch
// CHECK: = PropGet {{*}}key="\u{e9}"
// CHECK: = StrictEq
// CHECK: = PropGet {{*}}key="Known"
// CHECK: = StrictEq
// CHECK-NOT: = PropGet {{*}}key="Length"
// CHECK: Switch {{*}}cases=[4]
// CHECK-LABEL: function {{*}}name="known"
// CHECK-NOT: key="\u{e9}"
// CHECK-NOT: key="Known"
// CHECK: Switch {{*}}cases=[1, 7]
// CHECK-NOT: key="Known"
// CHECK: = Integer integer=7 @

declare function use(value: unknown): void;

enum Kind {
  "é" = 1,
  FromOtherName = Kind["é"] + 1,
  Next,
  Length = "text".length,
  Known = 7,
}

export function afterOtherName() {
  return Kind.Next;
}

export function fromLength() {
  return Kind.Length;
}

export function fromOtherName() {
  return Kind.FromOtherName;
}

export function inCase(value: unknown) {
  switch (value) {
    case Kind["é"]:
      use(1);
      break;
    case Kind?.Known:
      use(2);
      break;
    case Kind.Length:
      use(3);
      break;
  }
}

export function known(value: unknown) {
  switch (value) {
    case Kind.é:
      use(1);
      break;
    case Kind["Known"]:
      use(2);
      break;
  }
  return Kind.Known;
}
