// RUN: lower
// CHECK-LABEL: function {{*}}name="decimal"
// CHECK: [[decimalObject]] = Convert {{*}}flags=[IsExpected]}
// CHECK-NEXT: [[decimalIndex]] = Integer integer=1 @
// CHECK-NEXT: = ElemGet [[decimalObject]], [[decimalIndex]]
// CHECK-LABEL: function {{*}}name="fraction"
// CHECK: [[fractionObject]] = Convert {{*}}flags=[IsExpected]}
// CHECK-NEXT: = PropGet [[fractionObject]] key="1.5"
// CHECK-LABEL: function {{*}}name="largest"
// CHECK: [[largestObject]] = Convert {{*}}flags=[IsExpected]}
// CHECK-NEXT: [[largestIndex]] = Integer integer=4294967294 @
// CHECK-NEXT: = ElemGet [[largestObject]], [[largestIndex]]
// CHECK-LABEL: function {{*}}name="leadingZero"
// CHECK: [[leadingZeroObject]] = Convert {{*}}flags=[IsExpected]}
// CHECK-NEXT: = PropGet [[leadingZeroObject]] key="01"
// CHECK-LABEL: function {{*}}name="literal"
// CHECK-NEXT: ([[x]]: anything):
// CHECK: [[head]] = NewObject
// CHECK-NEXT: [[literalIndex]] = Integer integer=1 @
// CHECK-NEXT: ElemDefine [[head]], [[literalIndex]], [[x]]
// CHECK-LABEL: function {{*}}name="negative"
// CHECK: [[negativeObject]] = Convert {{*}}flags=[IsExpected]}
// CHECK-NEXT: = PropGet [[negativeObject]] key="-1"
// CHECK-LABEL: function {{*}}name="negativeZero"
// CHECK: [[negativeZeroObject]] = Convert {{*}}flags=[IsExpected]}
// CHECK-NEXT: [[negativeZeroIndex]] = Integer @
// CHECK-NEXT: = ElemGet [[negativeZeroObject]], [[negativeZeroIndex]]
// CHECK-LABEL: function {{*}}name="number"
// CHECK: [[numberObject]] = Convert {{*}}flags=[IsExpected]}
// CHECK-NEXT: [[numberIndex]] = Integer integer=1 @
// CHECK-NEXT: = ElemGet [[numberObject]], [[numberIndex]]
// CHECK-LABEL: function {{*}}name="pastLargest"
// CHECK: [[pastLargestObject]] = Convert {{*}}flags=[IsExpected]}
// CHECK-NEXT: = PropGet [[pastLargestObject]] key="4294967295"
// CHECK-LABEL: function {{*}}name="pattern"
// CHECK: [[patternIndex]] = Integer integer=1 @
// CHECK-NEXT: = ElemGet [[patternObject]], [[patternIndex]]
// CHECK-LABEL: function {{*}}name="store"
// CHECK-NEXT: ([[a]]: anything, [[v]]: anything):
// CHECK: [[storeObject]] = Convert [[a]] declared={type={{*}}flags=[IsExpected]}
// CHECK-NEXT: [[storeIndex]] = Integer integer=1 @
// CHECK-NEXT: ElemSet [[storeObject]], [[storeIndex]], [[v]]
// CHECK-LABEL: function {{*}}name="string"
// CHECK: [[stringObject]] = Convert {{*}}flags=[IsExpected]}
// CHECK-NEXT: [[stringIndex]] = Integer integer=1 @
// CHECK-NEXT: = ElemGet [[stringObject]], [[stringIndex]]

// RUN(NAMES): lower
// NAMES-NOT: key="1"
// NAMES-NOT: key="0"
// NAMES-NOT: key="4294967294"
// NAMES-NOT: = String
// NAMES-NOT: = Double

// RUN(ELEMENTS): lower
// ELEMENTS-COUNT-6: = ElemGet
// ELEMENTS-NOT: = ElemGet

export function decimal(a: any) {
  return a[1.0];
}

export function fraction(a: any) {
  return a[1.5];
}

export function largest(a: any) {
  return a[4294967294];
}

export function leadingZero(a: any) {
  return a["01"];
}

export function literal(x: any) {
  return { 1: x };
}

export function negative(a: any) {
  return a[-1];
}

export function negativeZero(a: any) {
  return a[-0];
}

export function number(a: any) {
  return a[1];
}

export function pastLargest(a: any) {
  return a[4294967295];
}

export function pattern(a: any) {
  const { 1: second } = a;
  return second;
}

export function store(a: any, v: any) {
  a[1] = v;
}

export function string(a: any) {
  return a["1"];
}
