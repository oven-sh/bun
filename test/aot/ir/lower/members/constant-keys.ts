// RUN: lower
// CHECK-LABEL: function {{*}}name="booleanKey"
// CHECK: [[booleanValue]] = Boolean boolean=true
// CHECK: = ElemGet [[o]], [[booleanValue]]
// CHECK-LABEL: function {{*}}name="largeNumber"
// CHECK-NOT: = Double
// CHECK: = PropGet [[o]] key="1e+21"
// CHECK-LABEL: function {{*}}name="nullKey"
// CHECK: [[nullValue]] = Null
// CHECK: = ElemGet [[o]], [[nullValue]]

// RUN(CONVERSIONS): lower
// CONVERSIONS-NOT: ToPropertyKey
// CONVERSIONS-NOT: key="true"
// CONVERSIONS-NOT: key="null"

export function booleanKey(o: any) {
  return o[true as any];
}

export function largeNumber(o: any) {
  return o[1e21];
}

export function nullKey(o: any) {
  return o[null as any];
}
