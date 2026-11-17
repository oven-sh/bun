// RUN: lower
// CHECK-LABEL: function {{*}}name="compound"
// CHECK: b0([[a]]: anything, [[k]]: anything):
// CHECK: = RequireObjectCoercible [[a]] nullishAccess=Update
// CHECK-NEXT: [[isObject]] = TypeTest [[k]] testedType=object
// CHECK-NEXT: Branch [[isObject]] -> taken [[convert]](| 0), notTaken [[keep]](| 0)
// CHECK: [[convert]]([[objectKey]]):
// CHECK-NEXT: [[converted]] = ToPropertyKey [[objectKey]]
// CHECK-NEXT: Jump -> next [[join]]([[converted]])
// CHECK-NOT: ToPropertyKey
// CHECK: [[join]]([[key]]):
// CHECK-NEXT: = ElemGet [[a]], [[key]]
// CHECK-NOT: ToPropertyKey
// CHECK: ElemSet [[a]], [[key]],
// CHECK-LABEL: function {{*}}name="index"
// CHECK-NOT: TypeTest
// CHECK-NOT: ToPropertyKey
// CHECK: [[two]] = Integer integer=2
// CHECK-NEXT: = ElemGet [[a]], [[two]]
// CHECK: ElemSet [[a]], [[two]],
// CHECK-NOT: TypeTest
// CHECK-NOT: ToPropertyKey
// CHECK-LABEL: function {{*}}name="logical"
// CHECK: = TypeTest [[k]] testedType=object
// CHECK: = ToPropertyKey
// CHECK-NOT: ToPropertyKey
// CHECK: = ElemGet [[a]], [[logicalKey]]
// CHECK-NOT: ToPropertyKey
// CHECK: ElemSet [[a]], [[logicalKey]],
// CHECK-LABEL: function {{*}}name="name"
// CHECK-NOT: TypeTest
// CHECK-NOT: ToPropertyKey
// CHECK: = PropGet [[a]] key="p"
// CHECK: PropSet [[a]], {{*}}key="p"
// CHECK-NOT: TypeTest
// CHECK-NOT: ToPropertyKey
// CHECK-LABEL: function {{*}}name="update"
// CHECK: = TypeTest [[k]] testedType=object
// CHECK: = ToPropertyKey
// CHECK-NOT: ToPropertyKey
// CHECK: = ElemGet [[a]], [[updateKey]]
// CHECK-NOT: ToPropertyKey
// CHECK: ElemSet [[a]], [[updateKey]],

// RUN(PRIMITIVE): lower
// PRIMITIVE-LABEL: function {{*}}name="compound"
// PRIMITIVE: Branch {{*}}notTaken [[keep]](| 0)
// PRIMITIVE: [[keep]]([[primitiveKey]]):
// PRIMITIVE-NEXT: Jump -> next [[join]]([[primitiveKey]])

export function compound(a: any, k: any) {
  a[k] += 1;
}

export function index(a: any) {
  a[2] += 1;
}

export function logical(a: any, k: any) {
  a[k] ??= 1;
}

export function name(a: any) {
  a["p"] += 1;
}

export function update(a: any, k: any) {
  a[k]++;
}
