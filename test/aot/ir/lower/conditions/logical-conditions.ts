// RUN: lower
// CHECK-LABEL: function {{*}}name="andChain"
// CHECK-COUNT-3: Branch
// CHECK-NOT: Branch
// CHECK-LABEL: function {{*}}name="comma"
// CHECK: = Call {{*}}calleeName="f"
// CHECK-COUNT-1: Branch
// CHECK-NOT: Branch
// CHECK-LABEL: function {{*}}name="conditional"
// CHECK-COUNT-3: Branch
// CHECK-NOT: Branch
// CHECK-LABEL: function {{*}}name="mixed"
// CHECK-COUNT-3: Branch
// CHECK-NOT: Branch
// CHECK-LABEL: function {{*}}name="nonNull"
// CHECK-COUNT-2: Branch
// CHECK-NOT: Branch
// CHECK-LABEL: function {{*}}name="nullish"
// CHECK: [[isNullish]] = TypeTest [[a]] testedType=undefined|null @
// CHECK-NEXT: Branch [[isNullish]] -> taken {{*}}(| 0), notTaken [[present]](| 0)
// CHECK: [[present]]([[value]]):
// CHECK-NEXT: [[isTruthy]] = ToBoolean [[value]]
// CHECK-NEXT: Branch [[isTruthy]] ->
// CHECK-LABEL: function {{*}}name="or"
// CHECK-COUNT-2: Branch
// CHECK-NOT: Branch
// CHECK-LABEL: function {{*}}name="value"
// CHECK-COUNT-2: Branch
// CHECK-NOT: Branch

// RUN(NULLISH): lower
// NULLISH-LABEL: function {{*}}name="nullish"
// NULLISH-COUNT-3: Branch
// NULLISH-NOT: Branch
// NULLISH-LABEL: function {{*}}name="or"

// RUN(JOINS): lower
// JOINS-NOT: Jump -> next [[block]]([[argument]]
// JOINS-LABEL: function {{*}}name="value"
// JOINS: Jump -> next [[join]]([[kept]])
// JOINS: [[join]]([[v]]):
// JOINS: = ToBoolean [[v]]

// RUN(NOWHERE): lower
// NOWHERE-NOT: = Boolean
// NOWHERE-NOT: LogicalNot

export function andChain(a: any, b: any, c: any) {
  if (a && b && c) return 1;
  return 0;
}

export function comma(f: any, a: any) {
  if ((f(), a)) return 1;
  return 0;
}

export function conditional(c: any, a: any, b: any) {
  if (c ? a : b) return 1;
  return 0;
}

export function mixed(a: any, b: any, c: any) {
  if (a && (b || c)) return 1;
  return 0;
}

export function nonNull(a: any, b: any) {
  if ((a && b)!) return 1;
  return 0;
}

export function nullish(a: any, b: any) {
  if (a ?? b) return 1;
  return 0;
}

export function or(a: any, b: any) {
  if (a || b) return 1;
  return 0;
}

export function value(a: any, b: any) {
  const v = a && b;
  if (v) return 1;
  return 0;
}
