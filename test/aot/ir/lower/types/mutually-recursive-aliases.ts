// RUN: link
// CHECK: variable {{*}}name="v" module=[[entry]] declared={type=undefined|null|string|absent|Array<undefined|null|number|Array> site=

// The type is cut where an alias comes back to itself: the array inside says nothing about its contents.
type A = string | [B];
type B = number | [A];

export let v: A;
