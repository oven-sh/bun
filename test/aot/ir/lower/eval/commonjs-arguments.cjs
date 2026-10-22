// RUN: link
// CHECK: evalscope [[scope]] mode=Sloppy flags=[IsInFunction, AllowsNewTarget] bindings=
// CHECK: {name="arguments" kind=Arguments
// CHECK: {name="exports" kind=MappedArgument depth=1 field=0 operand=[[object]]}
// CHECK: {name="require" kind=MappedArgument depth=1 field=1 operand=[[object]]}
// CHECK: {name="module" kind=MappedArgument depth=1 field=2 operand=[[object]]}
// CHECK: {name="__filename" kind=MappedArgument depth=1 field=3 operand=[[object]]}
// CHECK: {name="__dirname" kind=MappedArgument depth=1 field=4 operand=[[object]]}
// CHECK: function {{*}}kind=CommonJsModule flags=[IsSloppy] thisType
// CHECK: = CallDirect {{*}}function=[[wrapper]]
// CHECK: function [[wrapper]] module={{*}}flags=[IsSloppy, HasThis, TakesCallee, HasArgumentCount, HasHiddenRest]
// CHECK: [[arguments]] = CreateMappedArguments
// CHECK: = DirectEval {{*}}[[arguments]]{{*}}evalScope=[[scope]]

eval("arguments");
