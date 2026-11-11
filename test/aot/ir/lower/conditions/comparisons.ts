// RUN: lower
// CHECK-LABEL: function {{*}}name="bothLocals"
// CHECK: [[same]] = StrictEq [[a]], [[b]]
// CHECK-NEXT: Branch [[same]] -> taken [[sameTaken]](), notTaken {{*}}()
// CHECK: [[sameTaken]]():
// CHECK: Return [[a]]
// CHECK-LABEL: function {{*}}name="calls"
// CHECK: [[results]] = StrictEq
// CHECK-NEXT: Branch [[results]] -> taken [[callsTaken]](), notTaken [[callsOther]]()
// CHECK-LABEL: function {{*}}name="constant"
// CHECK: [[text]] = String string="a"
// CHECK: [[isText]] = StrictEq [[x]], [[text]]
// CHECK-NEXT: Branch [[isText]] -> taken [[textTaken]](), notTaken {{*}}()
// CHECK: [[textTaken]]():
// CHECK: Return [[x]]
// CHECK-LABEL: function {{*}}name="negated"
// CHECK: [[one]] = Integer integer=1 @
// CHECK: [[isOne]] = StrictEq [[y]], [[one]]
// CHECK-NEXT: Branch [[isOne]] -> taken {{*}}(), notTaken [[different]]()
// CHECK: [[different]]():
// CHECK: Return [[y]]
// CHECK-LABEL: function {{*}}name="relational"
// CHECK: [[below]] = Less [[i]], [[n]]
// CHECK-NEXT: Branch [[below]] -> taken [[belowTaken]](), notTaken {{*}}()
// CHECK: [[belowTaken]]():
// CHECK: = Add [[i]], [[n]]

// RUN(NOWHERE): lower
// NOWHERE-NOT: LogicalNot
// NOWHERE-NOT: ToBoolean

export function bothLocals(a: any, b: any): any {
  if (a === b) return a;
  return 0;
}

export function calls(f: any, g: any): any {
  if (f() === g()) return 1;
  return 0;
}

export function constant(x: any): any {
  if (x === "a") return x;
  return 0;
}

export function negated(x: any): any {
  if (x !== 1) return x;
  return 0;
}

export function relational(i: any, n: any): any {
  if (i < n) return i + n;
  return 0;
}
