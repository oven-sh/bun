// RUN: link
// CHECK: variable {{*}}name="a" module=[[entry]] declared={type=undefined|null|absent|Array<number> site=
// CHECK: variable {{*}}name="b" module=[[entry]] declared={type=undefined|null|absent|Array<undefined|null|number|string> site=
// CHECK: variable {{*}}name="c" module=[[entry]] declared={type=undefined|null|absent|Array<undefined|null|number|string> site=
// CHECK: variable {{*}}name="d" module=[[entry]] declared={type=undefined|null|absent|Array<never> site=
// CHECK: variable {{*}}name="e" module=[[entry]] declared={type=undefined|null|absent|Array<undefined|null|string> site=

export let a: number[];
export let b: [string, number];
export let c: [string, ...number[]];
export let d: [];
export let e: readonly string[];
