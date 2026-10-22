// RUN: lower
// CHECK: function {{*}}kind=CommonJsModule thisType
// CHECK: [[made]] = FinishObject
// CHECK: = CallDirect [[made]], {{*}}, [[made]], {{*}}function=[[wrapper]]
// CHECK: function [[wrapper]] module={{*}}flags=[HasThis, HasArgumentCount, HasHiddenRest] length=5
// CHECK-NEXT: b0([[this]]: anything, [[count]]: {{*}}, [[passedExports]]: anything, [[require]]: anything, [[module]]: anything, [[filename]]: anything, [[dirname]]: anything, [[rest]]: {{*}}):
// CHECK: [[arguments]] = CreateUnmappedArguments [[count]], [[rest]], [[passedExports]], [[require]], [[module]], [[filename]], [[dirname]]
// CHECK-NEXT: [[length]] = PropGet [[arguments]] key="length"
// CHECK-NEXT: PropSet [[passedExports]], [[length]] key="a"

// RUN(KIND): lower
// KIND-NOT: MappedArgument
// KIND-NOT: isFreeName

"use strict";
const length = arguments.length;
exports.a = length;
