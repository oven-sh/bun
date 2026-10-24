// RUN: lower
// CHECK-LABEL: function {{*}}name="anotherArray"
// CHECK-NOT: CompilerHelpers
// CHECK: = Call {{*}}calleeKey="from"
// CHECK-LABEL: function {{*}}name="elementsBesideTheLength"
// CHECK-NOT: CompilerHelpers
// CHECK: = Builtin builtin=ArrayFrom
// CHECK-LABEL: function {{*}}name="filled"
// CHECK: b0([[filledLength]]: {{*}}, [[filledValue]]: {{*}}):
// CHECK-NOT: ArrayPrototypeFill
// CHECK: [[check]] = Builtin builtin=CompilerHelpersCheckedArrayLength
// CHECK-NEXT: [[checked]] = Call [[check]], -, [[filledLength]]
// CHECK: [[fill]] = Builtin builtin=CompilerHelpersFilledArray
// CHECK-NEXT: = Call [[fill]], -, [[checked]], [[filledValue]]
// CHECK-LABEL: function {{*}}name="filledFromAnIndex"
// CHECK-NOT: CompilerHelpers
// CHECK: = Call {{*}}calleeKey="fill"
// CHECK-LABEL: function {{*}}name="filledWithConstant"
// CHECK: b0([[constantLength]]: {{*}}):
// CHECK-NOT: CompilerHelpersCheckedArrayLength
// CHECK: [[fillConstant]] = Builtin builtin=CompilerHelpersFilledArray
// CHECK-NEXT: = Call [[fillConstant]], -, [[constantLength]], {{*}}
// CHECK-LABEL: function {{*}}name="from"
// CHECK: b0([[fromLength]]: {{*}}, [[mapper]]: {{*}}):
// CHECK-NOT: NewObject
// CHECK: = TypeTest [[mapper]] testedType=undefined
// CHECK: [[makeWithoutMapper]] = Builtin builtin=CompilerHelpersArrayOfUndefined
// CHECK-NEXT: = Call [[makeWithoutMapper]], -, [[fromLength]]
// CHECK: [[make]] = Builtin builtin=CompilerHelpersArrayFromLength
// CHECK-NEXT: = Call [[make]], -, [[fromLength]], {{*}}
// CHECK-LABEL: function {{*}}name="fromWithFunction"
// CHECK: b0([[functionLength]]: {{*}}):
// CHECK-NOT: CompilerHelpersArrayOfUndefined
// CHECK: [[makeWithFunction]] = Builtin builtin=CompilerHelpersArrayFromLength
// CHECK-NEXT: = Call [[makeWithFunction]], -, [[functionLength]], {{*}}
// CHECK-LABEL: function {{*}}name="fromWithReceiver"
// CHECK-NOT: CompilerHelpers
// CHECK: = Builtin builtin=ArrayFrom
// CHECK-LABEL: function {{*}}name="fromWithoutMapper"
// CHECK: b0([[onlyLength]]: {{*}}):
// CHECK: [[makeUndefined]] = Builtin builtin=CompilerHelpersArrayOfUndefined
// CHECK-NEXT: = Call [[makeUndefined]], -, [[onlyLength]]
// CHECK-LABEL: function {{*}}name="indexes"
// CHECK-NOT: CompilerHelpers
// CHECK: = Call {{*}}calleeKey="keys"
// CHECK-LABEL: function {{*}}name="indexesAndMore"
// CHECK-NOT: CompilerHelpers
// CHECK: = Call {{*}}calleeKey="keys"
// CHECK-LABEL: function {{*}}name="mapped"
// CHECK: b0([[mappedLength]]: {{*}}):
// CHECK-NOT: ArrayPrototypeMap
// CHECK: [[makeMapped]] = Builtin builtin=CompilerHelpersMappedFilledArray
// CHECK-NEXT: = Call [[makeMapped]], -, [[mappedLength]], {{*}}, {{*}}
// CHECK-LABEL: function {{*}}name="mapperThatTakesTheList"
// CHECK-NOT: CompilerHelpersMappedFilledArray
// CHECK: = Builtin builtin=CompilerHelpersFilledArray
// CHECK: = Call {{*}}calleeKey="map"

export function anotherArray(Array, length) {
  return Array.from({ length });
}

export function elementsBesideTheLength(length) {
  return Array.from({ length, 0: "a" });
}

export function filled(length, value) {
  return Array(length).fill(value);
}

export function filledFromAnIndex(length) {
  return Array(length).fill(0, 1);
}

export function filledWithConstant(length) {
  return new Array(length).fill(0);
}

export function from(length, mapper) {
  return Array.from({ length }, mapper);
}

export function fromWithFunction(length) {
  return Array.from({ length }, (value, index) => index);
}

export function fromWithReceiver(length, mapper) {
  return Array.from({ length }, mapper, mapper);
}

export function fromWithoutMapper(length) {
  return Array.from({ length: length });
}

export function indexes(length) {
  return [...Array(length).keys()];
}

export function indexesAndMore(length) {
  return [...Array(length).keys(), 1];
}

export function mapped(length) {
  return Array(length).fill(0).map((value, index) => index);
}

export function mapperThatTakesTheList(length) {
  return Array(length).fill(0).map((value, index, list) => list);
}
