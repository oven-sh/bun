// RUN: link
// CHECK: layout [[inner]] {{*}}name="Inner" {{*}}fields=[{key="deeper" declared={type=anything}
// CHECK: layout {{*}}name="Outer" {{*}}fields=[{key="inner" declared={type=undefined|null|[[inner]] flags=[OmitsNull, OmitsUndefined]}
// CHECK: module [[module]] path=

// RUN(READ): link
// READ: layout {{*}}name="ReadInner" {{*}}fields=[{key="read"

// RUN(UNREAD): link
// UNREAD-NOT: layout {{*}}name="Deeper"

// A file says what the fields of a layout hold where it makes an object with the layout, converts a value to it or stores through it. Of a layout that it only mentions, or that a field names, it says the names. What the fields of such a layout name is not looked at.
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
