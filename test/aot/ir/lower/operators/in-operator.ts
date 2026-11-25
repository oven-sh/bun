// RUN: lower
// CHECK-LABEL: function {{*}}name="calls"
// CHECK: [[madeKey]] = Call {{*}}calleeName="f"
// CHECK: [[made]] = Call {{*}}calleeName="g"
// CHECK-NEXT: = ElemHas [[made]], [[madeKey]]
// CHECK-LABEL: function {{*}}name="computed"
// CHECK-NEXT: ([[k]]: anything, [[holder]]: anything):
// CHECK: = ElemHas [[holder]], [[k]]
// CHECK-LABEL: function {{*}}name="index"
// CHECK-NEXT: ([[indexed]]: anything):
// CHECK: [[two]] = Integer integer=2
// CHECK-NEXT: = ElemHas [[indexed]], [[two]]
// CHECK-LABEL: function {{*}}name="name"
// CHECK-NEXT: ([[named]]: anything):
// CHECK: = PropHas [[named]] key="a"

// RUN(NOWHERE): lower
// NOWHERE-NOT: ToPropertyKey

export function calls(f: any, g: any) {
  return f() in g();
}

export function computed(k: any, o: any) {
  return k in o;
}

export function index(o: any) {
  return 2 in o;
}

export function name(o: any) {
  return "a" in o;
}
