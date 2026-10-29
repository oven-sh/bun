// RUN: link
// CHECK: variable {{*}}name="a" module=[[entry]] declared={type=undefined|null|number|string|absent site=
// CHECK: variable {{*}}name="b" module=[[entry]] declared={type=undefined|null|number|string|absent site=
// CHECK: variable {{*}}name="c" module=[[entry]] declared={type=undefined|null|string|absent site=

// The order of the members doesn't matter. One member that holds a reference brings `undefined` and `null` into the union.
export let a: string | number;
export let b: number | string;
export let c: string | undefined;
