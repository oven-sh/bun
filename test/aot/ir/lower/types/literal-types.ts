// RUN: link
// CHECK: variable {{*}}name="a" module=[[entry]] declared={type=undefined|true|absent site=
// CHECK: variable {{*}}name="b" module=[[entry]] declared={type=undefined|false|absent site=
// CHECK: variable {{*}}name="c" module=[[entry]] declared={type=undefined|null|bigint|absent site=
// CHECK: variable {{*}}name="d" module=[[entry]] declared={type=undefined|null|string|absent site=
// CHECK: variable {{*}}name="e" module=[[entry]] declared={type=undefined|null|absent|"a" site=
// CHECK: variable {{*}}name="f" module=[[entry]] declared={type=undefined|1|absent site=
// CHECK: variable {{*}}name="g" module=[[entry]] declared={type=undefined|number|absent site=
// CHECK: variable {{*}}name="h" module=[[entry]] declared={type=undefined|number|absent site=
// CHECK: variable {{*}}name="i" module=[[entry]] declared={type=undefined|number|absent site=
// CHECK: variable {{*}}name="j" module=[[entry]] declared={type=undefined|int[1, 3]|absent site=
// CHECK: variable {{*}}name="k" module=[[entry]] declared={type=undefined|number|absent site=
// CHECK: variable {{*}}name="l" module=[[entry]] declared={type=undefined|int[-1, 1]|absent site=

// A literal type is the value itself, and it is checked. A union of integers is the range from the least to the greatest. A literal that no type of the IR holds is its kind: a bigint, a template, a fraction, and `0`, which is also the type of `-0`, alone or in a union. `undefined` is what a `let` without an initializer holds.
export let a: true;
export let b: false;
export let c: 10n;
export let d: `a${string}`;
export let e: "a";
export let f: 1;
export let g: 1.5;
export let h: 0;
export let i: -0;
export let j: 1 | 2 | 3;
export let k: 0 | 1 | 2;
export let l: -1 | 1;
