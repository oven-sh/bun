// RUN: lower
// CHECK-LABEL: function {{*}}name="arrayPattern"
// CHECK: b0([[a]]: anything, [[b]]: anything, [[pair]]: anything):
// CHECK: [[convertedPair]] = Convert [[pair]] declared={type=undefined|null|string|Array flags=[IsExpected]}
// CHECK: = IteratorOpen [[convertedPair]] elementCount=2 [isDestructuring]
// CHECK-LABEL: function {{*}}name="cast"
// CHECK-NOT: IteratorOpen
// CHECK-NOT: PropGet
// CHECK: b0([[target]]: anything, [[stored]]: anything):
// CHECK-NOT: IteratorOpen
// CHECK-NOT: PropGet
// CHECK: Return [[stored]]
// CHECK-LABEL: function {{*}}name="objectPattern"
// CHECK: [[convertedStored]] = Convert [[stored]] declared={type=undefined|null|number|string|symbol|bigint|L{{*}} flags=[IsExpected]}
// CHECK: = TypeTest [[convertedStored]] testedType=undefined|null
// CHECK: = PropGet {{*}}key="a"
// CHECK-LABEL: function {{*}}name="parenthesizedName"
// CHECK-NOT: IteratorOpen
// CHECK-NOT: PropGet
// CHECK: Return [[stored]]

export function arrayPattern(a: any, b: any, v: any) {
  [a, b] = v;
  return [a, b];
}

export function cast(x: unknown, v: any): unknown {
  (x as any) = v;
  return x;
}

export function objectPattern(a: any, v: any) {
  ({ a } = v);
  return a;
}

export function parenthesizedName(a: any, v: any): any {
  (a) = v;
  return a;
}
