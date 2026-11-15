// RUN: lower
// Nothing uses what these declare. `bun run` evaluates each of them all the same, and Reflect lists a member from its first read on: the statements stay.
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: = Builtin builtin=ReflectSet
// CHECK: = Builtin builtin=ReflectGet
// CHECK: = Builtin builtin=ReflectOwnKeys
// A statement that is only an expression takes no value, and `bun run` reads nothing of it.
// CHECK-NOT: = Builtin builtin=ReflectDeleteProperty
// A member that its holder is made with shows nothing, so such a statement is left out.
// CHECK-NOT: = Builtin builtin=MathMax
const variable = Reflect.set;
var list = [Reflect.get];
const kind = typeof Reflect.ownKeys;
Reflect.deleteProperty;
const made = Math.max;
