// RUN: lower
// CHECK-LABEL: function {{*}}name="definition"
// CHECK: b0([[definition_target]]: {{*}}, [[definition_source]]: {{*}}):
// CHECK: = Builtin builtin=ObjectGetOwnPropertyDescriptors
// CHECK-NEXT: [[definition_describe]] = Builtin builtin=CompilerHelpersDescribeUnlessOrdinary
// CHECK-NEXT: [[definition_described]] = Call [[definition_describe]], -, [[definition_source]]
// CHECK-NEXT: [[definition_define]] = Builtin builtin=CompilerHelpersDefinePropertiesFrom
// CHECK-NEXT: = Call [[definition_define]], -, [[definition_target]], [[definition_described]], [[definition_source]]
// CHECK-NEXT: Return
// CHECK-LABEL: function {{*}}name="descriptorsThatSomebodyHolds"
// CHECK: = Builtin builtin=ObjectGetOwnPropertyDescriptors
// CHECK: = Builtin builtin=ObjectDefineProperties

export function definition(target, source) {
  return Object.defineProperties(target, Object.getOwnPropertyDescriptors(source));
}

export function descriptorsThatSomebodyHolds(target, source) {
  const descriptors = Object.getOwnPropertyDescriptors(source);
  return Object.defineProperties(target, descriptors);
}
