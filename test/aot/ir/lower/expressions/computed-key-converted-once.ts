// RUN: lower
// CHECK-LABEL: function {{*}}name="compound"
// CHECK: b0([[a]]: anything, [[k]]: anything):
// CHECK: [[object]] = Convert [[a]] declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: [[isObject]] = TypeTest [[k]] testedType=object
// CHECK-NEXT: Branch [[isObject]] -> taken [[convert]](| 0), notTaken [[keep]](| 0)
// CHECK: [[convert]]([[objectKey]]):
// CHECK-NEXT: = RequireObjectCoercible [[object]]
// CHECK-NEXT: [[converted]] = ToPropertyKey [[objectKey]]
// CHECK-NEXT: Jump -> next [[join]]([[converted]])
// CHECK-NOT: ToPropertyKey
// CHECK: [[join]]([[key]]):
// CHECK-NEXT: = ElemGet [[object]], [[key]]
// CHECK-NOT: ToPropertyKey
// CHECK: ElemSet [[object]], [[key]],
// CHECK-LABEL: function {{*}}name="index"
// CHECK-NOT: TypeTest
// CHECK-NOT: ToPropertyKey
// CHECK: [[array]] = Convert [[a]] declared={type=undefined|null|Array<number> flags=[IsExpected]}
// CHECK-NEXT: [[two]] = Integer integer=2
// CHECK-NEXT: = ElemGet [[array]], [[two]]
// CHECK: ElemSet [[array]], [[two]],
// CHECK-NOT: TypeTest
// CHECK-NOT: ToPropertyKey
// CHECK-LABEL: function {{*}}name="logical"
// CHECK: [[logicalObject]] = Convert [[a]] declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: = TypeTest [[k]] testedType=object
// CHECK: = ToPropertyKey
// CHECK-NOT: ToPropertyKey
// CHECK: = ElemGet [[logicalObject]], [[logicalKey]]
// CHECK-NOT: ToPropertyKey
// CHECK: ElemSet [[logicalObject]], [[logicalKey]],
// CHECK-LABEL: function {{*}}name="name"
// CHECK-NOT: TypeTest
// CHECK-NOT: ToPropertyKey
// CHECK: [[namedObject]] = Convert [[a]] declared={type=undefined|null|number|string|symbol|bigint|L{{*}} flags=[IsExpected]}
// CHECK-NEXT: = PropGet [[namedObject]] key="p"
// CHECK: PropSet [[namedObject]], {{*}}key="p"
// CHECK-NOT: TypeTest
// CHECK-NOT: ToPropertyKey
// CHECK-LABEL: function {{*}}name="update"
// CHECK: [[updateObject]] = Convert [[a]] declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: = TypeTest [[k]] testedType=object
// CHECK: = ToPropertyKey
// CHECK-NOT: ToPropertyKey
// CHECK: = ElemGet [[updateObject]], [[updateKey]]
// CHECK-NOT: ToPropertyKey
// CHECK: ElemSet [[updateObject]], [[updateKey]],

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
