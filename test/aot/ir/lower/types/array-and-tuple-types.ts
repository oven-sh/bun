// RUN: link
// CHECK: variable {{*}}name="a" module=[[entry]] declared={type=undefined|null|absent|Array<number>
// CHECK: variable {{*}}name="b" module=[[entry]] declared={type=undefined|null|absent|Array<undefined|null|number|string>
// CHECK: variable {{*}}name="c" module=[[entry]] declared={type=undefined|null|absent|Array<undefined|null|number|string>
// CHECK: variable {{*}}name="d" module=[[entry]] declared={type=undefined|null|absent|Array<never>
// CHECK: variable {{*}}name="e" module=[[entry]] declared={type=undefined|null|absent|Array<undefined|null|string>

export let a: number[];
export let b: [string, number];
export let c: [string, ...number[]];
export let d: [];
export let e: readonly string[];
