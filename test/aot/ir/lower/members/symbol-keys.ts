// RUN: lower
// CHECK-LABEL: function {{*}}name="created"
// CHECK-NOT: @@
// CHECK: [[called]] = Call
// CHECK-NEXT: [[s]] = Convert [[called]] declared={type=undefined|null|symbol site=
// CHECK-NOT: @@
// CHECK: = ElemGet [[createdObject]], [[s]]
// CHECK-LABEL: function {{*}}name="shadowed"
// CHECK-NEXT: ([[o]]: anything, [[parameter]]: anything):
// CHECK-NOT: @@
// CHECK: [[shadowedObject]] = Convert [[o]] declared={type={{*}}flags=[IsExpected]}
// CHECK-NEXT: [[symbol]] = Convert [[parameter]] declared={type={{*}}flags=[IsExpected]}
// CHECK-NEXT: [[key]] = PropGet [[symbol]] key="iterator"
// CHECK-NEXT: = ElemGet [[shadowedObject]], [[key]]
// CHECK-LABEL: function {{*}}name="wellKnown"
// CHECK-NOT: = Builtin
// CHECK: = PropGet [[wellKnownObject]] key=@@iterator
// CHECK-NOT: ElemGet

export function created(o: any) {
  const s = Symbol("s");
  return o[s];
}

export function shadowed(o: any, Symbol: any) {
  return o[Symbol.iterator];
}

export function wellKnown(o: any) {
  return o[Symbol.iterator];
}
