// RUN: link
// STATISTIC: BuiltinTypesDegradedToViews = 0
// CHECK: layout [[foo]] name="Foo" module=[[entry]]
// CHECK: variable {{*}}name="a" module=[[entry]] declared={type=undefined|null|absent|Map<undefined|null|string, number> site=
// CHECK: variable {{*}}name="b" module=[[entry]] declared={type=undefined|null|absent|Set<undefined|null|[[foo]]> site=
// CHECK: variable {{*}}name="c" module=[[entry]] declared={type=undefined|null|absent|Date site=
// CHECK: variable {{*}}name="d" module=[[entry]] declared={type=undefined|null|absent|RegExp site=
// CHECK: variable {{*}}name="e" module=[[entry]] declared={type=undefined|null|absent|Map site=
// CHECK: variable {{*}}name="f" module=[[entry]] declared={type=undefined|null|absent|WeakMap<undefined|null|[[foo]], number> site=

interface Foo {
  x: number;
}

// The default library has DOM interfaces that extend Map and Set. They make neither a view.
export let a: Map<string, number>;
export let b: Set<Foo>;
export let c: Date;
export let d: RegExp;
export let e: Map<any, any>;
export let f: WeakMap<Foo, number>;
