// RUN: link
// CHECK: module [[entry]] path="{{*}}commonjs-names"
// CHECK: evalscope [[scope]] flags=[IsInFunction, AllowsNewTarget] bindings=
// CHECK: {name="exports" depth=1 layout=[[environment]] field=[[exports]] operand=[[names]]}
// CHECK: {name="require" depth=1 layout=[[environment]] field=[[require]] operand=[[names]]}
// CHECK: {name="module" depth=1 layout=[[environment]] field=[[module]] operand=[[names]]}
// CHECK: {name="__filename" depth=1 layout=[[environment]] field=[[filename]] operand=[[names]]}
// CHECK: {name="__dirname" depth=1 layout=[[environment]] field=[[dirname]] operand=[[names]]}
// CHECK: function [[body]] module=[[entry]] kind=CommonJsModule
// CHECK: [[object]] = NewObject {{*}}layout=[[environment]] fields=[0, 1, 2, 3, 4]
// CHECK: = DirectEval {{*}}[[object]] evalScope=[[scope]]

"use strict";
// The text is more than the name of a binding: a text that is only that is compiled as a read, without a scope record (names-one-binding.js).
eval("(module)");
