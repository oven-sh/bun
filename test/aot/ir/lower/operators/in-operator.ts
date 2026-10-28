// RUN: lower
// CHECK-LABEL: function {{*}}name="calls"
// CHECK: [[madeKey]] = Call {{*}}calleeName="f"
// CHECK: [[made]] = Call {{*}}calleeName="g"
// CHECK-NEXT: [[madeObject]] = Convert [[made]] declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: = ElemHas [[madeObject]], [[madeKey]]
// CHECK-LABEL: function {{*}}name="computed"
// CHECK-NEXT: ([[k]]: anything, [[holder]]: anything):
// CHECK: [[computedObject]] = Convert [[holder]] declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: = ElemHas [[computedObject]], [[k]]
// CHECK-LABEL: function {{*}}name="index"
// CHECK-NEXT: ([[indexed]]: anything):
// CHECK: [[two]] = Integer integer=2
// CHECK-NEXT: [[indexedObject]] = Convert [[indexed]] declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: = ElemHas [[indexedObject]], [[two]]
// CHECK-LABEL: function {{*}}name="name"
// CHECK-NEXT: ([[named]]: anything):
// CHECK: [[namedObject]] = Convert [[named]] declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: = PropHas [[namedObject]] key="a"

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
