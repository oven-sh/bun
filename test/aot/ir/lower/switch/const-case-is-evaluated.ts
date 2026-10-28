// RUN: lower
// CHECK-LABEL: function {{*}}name="constant"
// CHECK-NOT: Switch
// CHECK: [[read]] = GetModuleVariable
// CHECK: [[tested]] = CheckInitialized [[read]] name="A"
// CHECK: [[equal]] = StrictEq {{*}}, [[tested]]
// CHECK-NEXT: Branch [[equal]] -> taken {{*}}(| 0), notTaken [[remaining]](| 0)
// CHECK: [[remaining]]([[rest]]):
// CHECK-NEXT: Switch [[rest]] cases=[2] -> case {{*}}(| 0), otherwise
// CHECK-NOT: Switch

declare function use(value: unknown): void;

const A = 1;

export function constant(x: unknown) {
  switch (x) {
    case A:
      use(1);
      break;
    case 2:
      use(2);
      break;
  }
}
