// RUN: lower
// CHECK-LABEL: function {{*}}name="byKind"
// CHECK: b0([[value]]: {{*}}):
// CHECK-NOT: TypeOf
// CHECK-NOT: SwitchString
// CHECK: [[isText]] = TypeTest [[value]] testedType=string
// CHECK-NEXT: Branch [[isText]] -> taken [[text]](| 0), notTaken [[rest]](| 0)
// CHECK: [[rest]]([[noText]]):
// CHECK: = TypeTest [[noText]] testedType=number
// CHECK-LABEL: function {{*}}name="caseThatIsComputed"
// CHECK: = TypeOf
// CHECK-LABEL: function {{*}}name="objects"
// CHECK: b0([[subject]]: {{*}}):
// CHECK-NOT: TypeOf
// CHECK: [[isFunction]] = TypeTest [[subject]] testedType=function
// CHECK-NEXT: Branch [[isFunction]] -> taken {{*}}(| 0), notTaken [[others]](| 0)
// CHECK: [[others]]([[notCallable]]):
// CHECK: = TypeTest [[notCallable]] testedType=null|object
export function byKind(value) { switch (typeof value) { case "string": return value.length; case "number": return value + 1; default: return 0; } }
export function caseThatIsComputed(value, name) { switch (typeof value) { case name: return 1; case "number": return 2; } return 0; }
export function objects(value) { switch (typeof value) { case "object": return 1; } return 0; }
