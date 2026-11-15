// RUN: link
// CHECK: layout {{*}}fields=[{key="inner" declared={type=undefined|null|[[inner]] flags=[OmitsNull, OmitsUndefined]}
// CHECK: layout [[inner]] {{*}}fields=[{key="deeper" declared={type=undefined|null|[[deeper]] flags=[OmitsNull, OmitsUndefined]}
// CHECK: layout [[deeper]] flags=[IsNeverAllocated]
// CHECK: module [[module]] path=

// RUN(READ): link
// READ: layout {{*}}fields=[{key="read"

// RUN(UNREAD): link
// UNREAD-NOT: layout {{*}}fields=[{key="c"

// A file says what the fields of a layout hold where it makes an object with the layout or declares a position of one of its types: each field has the type that is declared for it. A layout that only such a field names is not looked at: the file says nothing of it, not even its names.
interface Outer {
  inner: Inner;
}

interface Inner {
  deeper: Deeper;
}

interface Deeper {
  c: number;
}

interface ReadOuter {
  readInner: ReadInner;
}

interface ReadInner {
  read: number;
}

export function pass(a: Outer) {
  return a;
}

export function read(a: ReadOuter) {
  return a.readInner.read;
}

export function make(inner: Inner) {
  return [pass({ inner }), read({ readInner: { read: 1 } })];
}
