// RUN: link
// CHECK: variable {{*}}name="a" module=[[entry]] declared={type=undefined|boolean|absent}
// CHECK: variable {{*}}name="b" module=[[entry]] declared={type=undefined|number|absent}
// CHECK: variable {{*}}name="c" module=[[entry]] declared={type=undefined|null|bigint|absent flags={{*}}}
// CHECK: variable {{*}}name="d" module=[[entry]] declared={type=undefined|null|string|absent flags={{*}}}
// CHECK: variable {{*}}name="e" module=[[entry]] declared={type=undefined|null|symbol|absent flags={{*}}}
// CHECK: variable {{*}}name="f" module=[[entry]] declared={type=undefined|null|object|absent flags={{*}}}

// A type that holds a reference takes `undefined` and `null` too. `boolean` and `number` don't: their `undefined` is what a `let` without an initializer holds.
export let a: boolean, b: number, c: bigint, d: string, e: symbol, f: object;
