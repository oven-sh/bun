// RUN: link
// CHECK: layout [[point]] module=[[entry]] {{*}}fields=[{key="x"
// CHECK: layout [[sized]] module=[[entry]] {{*}}fields=[{key="length"
// CHECK: variable {{*}}name="a" module=[[entry]] declared={type=undefined|null|string|absent|[[sized]]
// CHECK: variable {{*}}name="b" module=[[entry]] declared={type=undefined|null|absent|[[point]]

// An object type takes every primitive that has its members: a string has a `length`, so `string` stands beside the layout. No primitive has an `x`.
export let a: { length: number };
export let b: { x: number };
