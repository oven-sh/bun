// RUN: link
// The module graph erases `const held = { .. };` in front of `module.exports = held;`: each name of the literal is a variable of the module, and the store evaluates the literal.
// The scope walk walks the literal there too. Without it the functions of the literal are lowered with no record of their loops, of what they capture and of the names they read.
// CHECK: module [[held]] path="{{*}}/imports/literal-under-a-name/held.cjs"
// CHECK: function {{*}}module=[[held]] kind=CommonJsModule
// CHECK-NOT: NewObject
// CHECK: = NewClosure function=[[sum]]
// CHECK: = NewClosure function=[[maker]]
// CHECK: = NewClosure function=[[down]]
// CHECK: Return
// CHECK: function [[sum]] name="sum"
// CHECK: LoopHint
// CHECK: Return
// CHECK: function [[maker]] name="maker"
// CHECK: = NewClosure {{*}}function=[[inner]]
// CHECK: function [[down]] name="down"{{*}}TakesCallee
// CHECK: function [[inner]] {{*}}kind=Arrow{{*}}variableName="a"

"use strict";
const held = require("./imports/literal-under-a-name/held.cjs");
console.log(held.sum(1, 2), held.maker(1)(2), held.down(3));
