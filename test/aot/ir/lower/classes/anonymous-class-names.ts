// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: [[key]] = ToPropertyKey
// CHECK: [[closure]] = NewClosure
// CHECK: SetFunctionName [[closure]], [[key]]
// CHECK: = NewClass [[closure]]

// RUN(COMPUTED): lower
// COMPUTED-COUNT-1: SetFunctionName
// COMPUTED-NOT: SetFunctionName

// RUN(HEADERS): lower
// HEADERS: function {{*}}name="default" {{*}}kind=BaseConstructor
// HEADERS: function {{*}}name="A" {{*}}kind=BaseConstructor

// RUN(INFERRED): lower
// INFERRED-NOT: name="A"{{*}}HasExplicitName
// INFERRED-NOT: name="default"{{*}}HasExplicitName

declare const k: string;

export const A = class {};

export const o = { [k]: class {} };

export default class {}
