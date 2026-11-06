// RUN: lower
// CHECK-LABEL: function {{*}}name="empty"
// CHECK: [[emptyTest]] = TypeTest [[emptyValue]] testedType=undefined|null @
// CHECK-NEXT: Branch [[emptyTest]] -> taken {{*}}(| 0), notTaken {{*}}(| 0)
// CHECK-LABEL: function {{*}}name="properties"
// CHECK-NEXT: ([[v]]:
// CHECK: [[source]] = Convert [[v]] declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: [[test]] = TypeTest [[source]] testedType=undefined|null @
// CHECK-NEXT: Branch [[test]] -> taken [[nullish]](| 0), notTaken [[present]](| 0)
// CHECK: [[present]]([[o]]):
// CHECK: = PropGet [[o]] key="a"
// CHECK: = PropGet [[o]] key="b"
// CHECK: = PropGet [[o]] key="d-e"
// CHECK: [[called]] = Call {{*}}calleeName="k"
// CHECK: [[key]] = ToPropertyKey [[called]]
// CHECK: = ElemGet [[o]], [[key]]
// CHECK: [[one]] = Integer integer=1 @
// CHECK: = ElemGet [[o]], [[one]]

// RUN(THROW): lower
// THROW-LABEL: function {{*}}name="properties"
// THROW: frequency=Unlikely:
// THROW-NEXT: [[error]] = NewRuntimeError runtimeError=NotDestructurable name="a"
// THROW-NEXT: Throw [[error]]

// RUN(READS): lower
// READS-LABEL: function {{*}}name="empty"
// READS-NOT: PropGet
// READS-NOT: ElemGet
// READS-LABEL: function {{*}}name="properties"

export function empty(v: any) {
  ({} = v);
}

export function properties(v: any, k: any) {
  const { a, b: c, "d-e": f, [k()]: g, 1: h } = v;
  return [a, c, f, g, h];
}
