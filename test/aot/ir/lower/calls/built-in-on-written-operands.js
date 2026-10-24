// RUN: lower
// CHECK-LABEL: function {{*}}name="anotherObject"
// CHECK: NewArray
// CHECK: = Call
// CHECK-LABEL: function {{*}}name="definition"
// CHECK: b0([[definition_target]]: {{*}}, [[definition_source]]: {{*}}):
// CHECK-NOT: ObjectGetOwnPropertyDescriptors
// CHECK: [[definition_describe]] = Builtin builtin=CompilerHelpersDescribeUnlessOrdinary
// CHECK-NEXT: [[definition_described]] = Call [[definition_describe]], -, [[definition_source]]
// CHECK: [[definition_define]] = Builtin builtin=CompilerHelpersDefinePropertiesFrom
// CHECK-NEXT: = Call [[definition_define]], -, [[definition_target]], [[definition_described]], [[definition_source]]
// CHECK-LABEL: function {{*}}name="descriptorsThatSomebodyHolds"
// CHECK: = Builtin builtin=ObjectGetOwnPropertyDescriptors
// CHECK: = Builtin builtin=ObjectDefineProperties
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
// CHECK-NEXT: ElemDefine [[keyThatIsComputed_made]], [[keyThatIsComputed_key]], [[keyThatIsComputed_value]]
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

export function definition(target, source) {
  return Object.defineProperties(target, Object.getOwnPropertyDescriptors(source));
}

export function descriptorsThatSomebodyHolds(target, source) {
  const descriptors = Object.getOwnPropertyDescriptors(source);
  return Object.defineProperties(target, descriptors);
}
