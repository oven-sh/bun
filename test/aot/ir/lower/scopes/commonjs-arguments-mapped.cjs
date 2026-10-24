// RUN: lower
// CHECK: function {{*}}kind=CommonJsModule flags=[IsSloppy] thisType
// CHECK: [[made]] = FinishObject
// CHECK: [[closure]] = NewClosure function=[[wrapper]]
// CHECK: = CallDirect [[made]], [[closure]], {{*}}, [[made]], {{*}}function=[[wrapper]]
// CHECK: function [[wrapper]] module={{*}}flags=[IsSloppy, HasThis, TakesCallee, HasArgumentCount, HasHiddenRest] length=5 {{*}}parameters=[{type=anything}, {type=anything}, {type=anything}, {type=anything}, {type=anything}] results=
// CHECK-NEXT: b0([[this]]: anything, [[callee]]: function, [[count]]: {{*}}, [[exports]]: anything, [[require]]: anything, [[module]]: anything, [[filename]]: anything, [[dirname]]: anything, [[rest]]: {{*}}):
// CHECK: [[arguments]] = CreateMappedArguments [[callee]], [[count]], [[rest]], [[exports]], [[require]], [[module]], [[filename]], [[dirname]]
// CHECK: = PropGet [[arguments]] key="length"
// CHECK: = GetMappedArgument [[arguments]] @
// CHECK: SetMappedArgument [[arguments]], {{*}}index=1
// CHECK: = GetMappedArgument [[arguments]] index=2

// RUN(KIND): lower
// KIND-NOT: CreateUnmappedArguments
// KIND-NOT: isFreeName

// RUN(INNER): lower
// INNER-LABEL: function {{*}}kind=Arrow
// INNER-NEXT: b0([[captured]]: object):
// INNER: = GetMappedArgument [[captured]] index=4

// A CommonJS file in which `arguments` or `eval` stands keeps the function of five parameters. The body of the module makes what it is passed and calls it.
const length = arguments.length;
const first = exports;
require = first;
const third = module;
const inner = () => __dirname;
inner(length, third);
