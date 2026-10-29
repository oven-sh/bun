// RUN: link
// CHECK: variable {{*}}name="a" module=[[entry]] declared={type=undefined|boolean|absent site=w{{*}}}
// CHECK: variable {{*}}name="b" module=[[entry]] declared={type=undefined|number|absent site=w{{*}}}
// CHECK: variable {{*}}name="c" module=[[entry]] declared={type=undefined|null|bigint|absent site=w{{*}}}
// CHECK: variable {{*}}name="d" module=[[entry]] declared={type=undefined|null|string|absent site=w{{*}}}
// CHECK: variable {{*}}name="e" module=[[entry]] declared={type=undefined|null|symbol|absent site=w{{*}}}
// CHECK: variable {{*}}name="f" module=[[entry]] declared={type=undefined|null|object|absent site=w{{*}}}

// A type that holds a reference takes `undefined` and `null` too. `boolean` and `number` don't: their `undefined` is what a `let` without an initializer holds.
export let a: boolean, b: number, c: bigint, d: string, e: symbol, f: object;
