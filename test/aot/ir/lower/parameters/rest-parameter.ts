// RUN: lower
// CHECK-LABEL: function {{*}}name="f"{{*}}flags=[HasRestParameter, {{*}} length=1 {{*}}}, {type=Array<undefined|null|string> site=
// CHECK: b0([[a]]: number, [[rest]]: Array<undefined|null|string>):
// CHECK-LABEL: function {{*}}name="g"{{*}} length=2 {{*}}}, {type=undefined|null|Array<undefined|null|string> site=

// RUN(PLAIN): lower
// PLAIN-NOT: name="g"{{*}}HasRestParameter

// RUN(FLAGS): lower
// FLAGS: function {{*}}name="f"{{*}}, {type=Array<undefined|null|string> site=[[restSite]] flags=[IsFromCompiler, OmitsNull, OmitsUndefined]}]
// FLAGS: function {{*}}name="g"{{*}}, {type=undefined|null|Array<undefined|null|string> site=[[listSite]] flags=[OmitsNull, OmitsUndefined]}]

export function f(a: number, ...rest: string[]) {}

export function g(a: number, list: string[]) {}
