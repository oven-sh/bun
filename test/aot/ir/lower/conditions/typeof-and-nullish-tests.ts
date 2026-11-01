// RUN: lower
// CHECK-LABEL: function {{*}}name="looseNotNull"
// CHECK: [[test]] = TypeTest [[x]] testedType=undefined|null @
// CHECK-NEXT: Branch [[test]] -> taken [[taken]](| 0), notTaken [[notTaken]](| 0)
// CHECK: [[notTaken]]({{*}}):
// CHECK-NEXT: Jump -> next [[afterNotTaken]]()
// CHECK: [[afterNotTaken]]():
// CHECK-NEXT: = Integer integer=1 @
// CHECK-LABEL: function {{*}}name="looseNull"
// CHECK: [[test]] = TypeTest [[x]] testedType=undefined|null @
// CHECK-NEXT: Branch [[test]] -> taken [[taken]](| 0), notTaken [[notTaken]](| 0)
// CHECK: [[taken]]({{*}}):
// CHECK-NEXT: Jump -> next [[afterTaken]]()
// CHECK: [[afterTaken]]():
// CHECK-NEXT: = Integer integer=1 @
// CHECK-LABEL: function {{*}}name="strictNull"
// CHECK: [[test]] = TypeTest [[x]] testedType=null @
// CHECK-NEXT: Branch [[test]] -> taken [[taken]](| 0), notTaken [[notTaken]](| 0)
// CHECK-LABEL: function {{*}}name="strictUndefined"
// CHECK: [[test]] = TypeTest [[x]] testedType=undefined @
// CHECK-NEXT: Branch [[test]] -> taken [[taken]](| 0), notTaken [[notTaken]](| 0)
// CHECK-LABEL: function {{*}}name="typeofLoose"
// CHECK: [[test]] = TypeTest [[x]] testedType=string @
// CHECK-NEXT: Branch [[test]] -> taken [[taken]](| 0), notTaken [[notTaken]](| 0)
// CHECK-LABEL: function {{*}}name="typeofNot"
// CHECK: [[test]] = TypeTest [[x]] testedType=string @
// CHECK-NEXT: Branch [[test]] -> taken [[taken]](| 0), notTaken [[notTaken]](| 0)
// CHECK: [[notTaken]]({{*}}):
// CHECK-NEXT: Jump -> next [[afterNotTaken]]()
// CHECK: [[afterNotTaken]]():
// CHECK-NEXT: = Integer integer=1 @
// CHECK-LABEL: function {{*}}name="typeofReversed"
// CHECK: [[test]] = TypeTest [[x]] testedType=number @
// CHECK-NEXT: Branch [[test]] -> taken [[taken]](| 0), notTaken [[notTaken]](| 0)
// CHECK-LABEL: function {{*}}name="typeofStrict"
// CHECK: [[test]] = TypeTest [[x]] testedType=string @
// CHECK-NEXT: Branch [[test]] -> taken [[taken]](| 0), notTaken [[notTaken]](| 0)
// CHECK: [[taken]]({{*}}):
// CHECK-NEXT: Jump -> next [[afterTaken]]()
// CHECK: [[afterTaken]]():
// CHECK-NEXT: = Integer integer=1 @
// CHECK-LABEL: function {{*}}name="undefinedReversed"
// CHECK: [[test]] = TypeTest [[x]] testedType=undefined @
// CHECK-NEXT: Branch [[test]] -> taken [[taken]](| 0), notTaken [[notTaken]](| 0)
// CHECK: [[notTaken]]({{*}}):
// CHECK-NEXT: Jump -> next [[afterNotTaken]]()
// CHECK: [[afterNotTaken]]():
// CHECK-NEXT: = Integer integer=1 @
// CHECK-LABEL: function {{*}}name="voidZero"
// CHECK: [[test]] = TypeTest [[x]] testedType=undefined @
// CHECK-NEXT: Branch [[test]] -> taken [[taken]](| 0), notTaken [[notTaken]](| 0)

// RUN(TESTS): lower
// TESTS-COUNT-10: = TypeTest
// TESTS-NOT: = TypeTest

// RUN(BRANCHES): lower
// BRANCHES-COUNT-10: Branch
// BRANCHES-NOT: Branch

// RUN(NOWHERE): lower
// NOWHERE-NOT: = TypeOf
// NOWHERE-NOT: StrictEq
// NOWHERE-NOT: = Eq
// NOWHERE-NOT: LogicalNot
// NOWHERE-NOT: ToBoolean

// RUN(CONSTANTS): lower
// CONSTANTS-LABEL: function {{*}}name="looseNotNull"
// CONSTANTS-NOT: = Undefined
// CONSTANTS-NOT: = Null
// CONSTANTS-NOT: = String

export function looseNotNull(x: any) {
  if (x != null) return 1;
  return 0;
}

export function looseNull(x: any) {
  if (x == null) return 1;
  return 0;
}

export function strictNull(x: any) {
  if (x === null) return 1;
  return 0;
}

export function strictUndefined(x: any) {
  if (x === undefined) return 1;
  return 0;
}

export function typeofLoose(x: any) {
  if (typeof x == "string") return 1;
  return 0;
}

export function typeofNot(x: any) {
  if (typeof x !== "string") return 1;
  return 0;
}

export function typeofReversed(x: any) {
  if ("number" === typeof x) return 1;
  return 0;
}

export function typeofStrict(x: any) {
  if (typeof x === "string") return 1;
  return 0;
}

export function undefinedReversed(x: any) {
  if (undefined !== x) return 1;
  return 0;
}

export function voidZero(x: any) {
  if (void 0 === x) return 1;
  return 0;
}
