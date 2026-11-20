// RUN: lower
// CHECK-LABEL: function {{*}}name="anotherObject"
// CHECK: NewArray
// CHECK: = Call
// CHECK-LABEL: function {{*}}name="emptyList"
// CHECK-NOT: Construct
// CHECK: = NewArray
// CHECK-LABEL: function {{*}}name="emptyObject"
// CHECK-NOT: Construct
// CHECK: [[emptyObject_made]] = NewObject
// CHECK-NEXT: = FinishObject [[emptyObject_made]]
// CHECK-LABEL: function {{*}}name="emptyObjectByCall"
// CHECK-NOT: = Call
// CHECK: [[emptyObjectByCall_made]] = NewObject
// CHECK-NEXT: = FinishObject [[emptyObjectByCall_made]]
// CHECK-LABEL: function {{*}}name="fromEntries"
// CHECK-NOT: NewArray
// CHECK-NOT: = Call
// CHECK: [[fromEntries_made]] = NewObject -, {{*}}fields=[0, 1]
// CHECK: = FinishObject [[fromEntries_made]]
// CHECK-LABEL: function {{*}}name="keyThatIsComputed"
// CHECK: b0([[keyThatIsComputed_key]]: {{*}}, [[keyThatIsComputed_value]]: {{*}}):
// CHECK-NOT: NewArray
// CHECK-NOT: ToPropertyKey
// CHECK: [[keyThatIsComputed_made]] = NewDictionary
// CHECK-NEXT: ElemDefine [[keyThatIsComputed_made]], [[keyThatIsComputed_key]], [[keyThatIsComputed_value]] calledBuiltin=ObjectFromEntries
// CHECK-LABEL: function {{*}}name="listOfLength"
// CHECK-NOT: NewArray
// CHECK: = Construct {{*}}calleeName="Array"
// CHECK-LABEL: function {{*}}name="map"
// CHECK: b0([[map_a]]: {{*}}, [[map_b]]: {{*}}):
// CHECK-NOT: NewArray
// CHECK: [[map_made]] = Construct {{*}}calleeName="Map"
// CHECK: [[map_set]] = Builtin builtin=MapPrototypeSet
// CHECK-NEXT: = Call [[map_set]], [[map_made]], {{*}}, [[map_a]]
// CHECK: = Call {{*}}, [[map_made]], {{*}}, [[map_b]]
// CHECK-LABEL: function {{*}}name="mapOfConstants"
// CHECK: [[mapOfConstants_list]] = Data
// CHECK: = Construct {{*}}, -, {{*}}
// CHECK-LABEL: function {{*}}name="pairOfOne"
// CHECK: = Builtin builtin=ObjectFromEntries
// CHECK: = Call
// CHECK-LABEL: function {{*}}name="set"
// CHECK: b0([[set_a]]: {{*}}, [[set_b]]: {{*}}):
// CHECK-NOT: NewArray
// CHECK: [[set_made]] = Construct {{*}}calleeName="Set"
// CHECK: [[set_add]] = Builtin builtin=SetPrototypeAdd
// CHECK-NEXT: = Call [[set_add]], [[set_made]], [[set_a]]
// CHECK: = Call {{*}}, [[set_made]], [[set_b]]
// CHECK-LABEL: function {{*}}name="setWithHole"
// CHECK: = NewArray
// CHECK: = Construct {{*}}, -, {{*}}
// CHECK-LABEL: function {{*}}name="spreadOfPairs"
// CHECK: = Builtin builtin=ObjectFromEntries
// CHECK: = Call

export function fromEntries(a, b) {
  return Object.fromEntries([["x", a], ["y", b]]);
}

export function keyThatIsComputed(key, value) {
  return Object.fromEntries([[key, value]]);
}

export function pairOfOne(a) {
  return Object.fromEntries([["x"], ["y", a]]);
}

export function spreadOfPairs(pairs, a) {
  return Object.fromEntries([...pairs, ["y", a]]);
}

export function anotherObject(Object, a) {
  return Object.fromEntries([["x", a]]);
}

export function map(a, b) {
  return new Map([["x", a], ["y", b]]);
}

export function mapOfConstants() {
  return new Map([["x", 1], ["y", 2]]);
}

export function set(a, b) {
  return new Set([a, b]);
}

export function setWithHole(a) {
  return new Set([a, , a]);
}

export function emptyList() {
  return new Array();
}

export function listOfLength(length) {
  return new Array(length);
}

export function emptyObject() {
  return new Object();
}

export function emptyObjectByCall() {
  return Object();
}
