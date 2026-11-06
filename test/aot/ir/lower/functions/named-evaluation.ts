// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK-NOT: SetFunctionName
// CHECK: [[key]] = ToPropertyKey
// CHECK: [[closure]] = NewClosure function=
// CHECK-NEXT: SetFunctionName [[closure]], [[key]]
// CHECK-NOT: SetFunctionName
// CHECK-LABEL: function {{*}}name="a" {{*}}flags=[IsChecked]
// CHECK-LABEL: function {{*}}name="b" {{*}}kind=Arrow flags=[IsChecked]
// CHECK-LABEL: function {{*}}name="c" {{*}}kind=BaseConstructor flags=[HasNewTarget, IsChecked]

// RUN(NAMED): lower
// NAMED-COUNT-3: function {{*}}name=
// NAMED-NOT: function {{*}}name=

declare const key: string;

export const a = function () {};

export const b = () => {};

export const c = class {};

export const o = { [key]: function () {} };
