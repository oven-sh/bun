// RUN: link
// CHECK: variable {{*}}name="a" module=[[entry]] declared={type=anything
// CHECK: variable {{*}}name="b" module=[[entry]] declared={type=undefined|absent site=
// CHECK: variable {{*}}name="c" module=[[entry]] declared={type=undefined|null|absent site=

// `undefined` and `null` hold no reference, so nothing is added to them but the `undefined` that a `let` without an initializer holds. A location written `never` holds whatever a cast lets in, so its type says nothing.
export let a: never;
export let b: undefined;
export let c: null;
