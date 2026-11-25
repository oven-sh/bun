// RUN: link
// CHECK: layout {{*}}name="Holder" {{*}}key="name" declared={type=undefined|null|"a"|"b" flags=[OmitsNull, OmitsUndefined]}
// CHECK: variable {{*}}name="a" module=[[entry]] declared={type=undefined|true|absent}
// CHECK: variable {{*}}name="b" module=[[entry]] declared={type=undefined|false|absent}
// CHECK: variable {{*}}name="c" module=[[entry]] declared={type=undefined|null|absent|"a" flags=[OmitsNull]}
// CHECK: variable {{*}}name="d" module=[[entry]] declared={type=undefined|null|absent|"a"|"b" flags=[OmitsNull]}
// CHECK: variable {{*}}name="e" module=[[entry]] declared={type=undefined|1|absent}
// CHECK: variable {{*}}name="f" module=[[entry]] declared={type=undefined|int[1, 3]|absent}
// CHECK: variable {{*}}name="g" module=[[entry]] declared={type=undefined|null|true|1|absent|"a" flags=[OmitsNull]}
// CHECK: variable {{*}}name="h" module=[[entry]] declared={type=undefined|number|absent}
// CHECK: variable {{*}}name="i" module=[[entry]] declared={type=undefined|0|absent}
// CHECK: variable {{*}}name="j" module=[[entry]] declared={type=undefined|null|bigint|absent flags=[OmitsNull]}
// CHECK: variable {{*}}name="k" module=[[entry]] declared={type=undefined|null|string|absent flags=[OmitsNull]}

// RUN(FUNCTION): lower
// FUNCTION-LABEL: function {{*}}name="takes"
// FUNCTION: parameters=[{type=undefined|null|"a"|"b" flags=[OmitsNull, OmitsUndefined]},
// FUNCTION: results=[{type=true}]
// FUNCTION: = Convert {{*}}declared={type=undefined|null|"a"|"b"

// A literal type is a type: the position's type holds the value itself, in a variable, a field, a parameter, a result and a cast. The position has a site and no flag, so it is checked like any other. A literal that no type of the IR holds is sent as its kind: a fraction, `0` (which is also the type of `-0`), a bigint, a template. A string holds a reference, so its literals take `undefined` and `null` too. A boolean or a number doesn't: the `undefined` of the variables is what a `let` without an initializer holds, and the result has none.
class Holder {
  name: "a" | "b" = "a";
}

export let a: true;
export let b: false;
export let c: "a";
export let d: "a" | "b";
export let e: 1;
export let f: 1 | 2 | 3;
export let g: "a" | 1 | true;
export let h: 1.5;
export let i: 0;
export let j: 10n;
export let k: `a${string}`;

export function takes(name: "a" | "b", value: string, holder: Holder): true {
  holder.name = value as "a" | "b";
  return true;
}
