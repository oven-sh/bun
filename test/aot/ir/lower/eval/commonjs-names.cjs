// RUN: link
// CHECK: module [[entry]] path="{{*}}commonjs-names.cjs"
// CHECK: evalscope [[scope]] flags=[IsInFunction, AllowsNewTarget] bindings=
// CHECK: {name="exports" depth=1 variable=[[exports]]}
// CHECK: {name="require" depth=1 variable=[[require]]}
// CHECK: {name="module" depth=1 variable=[[module]]}
// CHECK: {name="__filename" depth=1 variable=[[filename]]}
// CHECK: {name="__dirname" depth=1 variable=[[dirname]]}
// CHECK: function [[body]] module=[[entry]] kind=CommonJsModule
// CHECK: PutModuleVariable {{*}}variable=[[module]]
// CHECK: = DirectEval {{*}}evalScope=[[scope]]

"use strict";
// The text is more than the name of a binding: a text that is only that is compiled as a read, without a scope record (names-one-binding.js).
eval("(module)");
