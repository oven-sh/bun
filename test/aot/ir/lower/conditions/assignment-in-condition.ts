// RUN: lower
// CHECK-LABEL: function {{*}}name="cast"
// CHECK: [[castResult]] = Call {{*}}calleeName="f"
// CHECK: [[castTest]] = TypeTest [[castResult]] testedType=undefined|null @
// CHECK-NEXT: Branch [[castTest]] -> taken {{*}}(| 0), notTaken [[castPresent]](| 0)
// CHECK: [[castPresent]]([[castLeft]]):
// CHECK-NEXT: [[castNamed]] = NarrowByTest [[castResult]], [[castLeft]]
// CHECK: Return [[castNamed]]
// CHECK-LABEL: function {{*}}name="loop"
// CHECK: [[item]] = Call {{*}}calleeName="next"
// CHECK: [[loopTest]] = TypeTest [[item]] testedType=undefined @
// CHECK-NEXT: Branch [[loopTest]] -> taken {{*}}(| 0), notTaken [[body]](| 0)
// CHECK: [[body]]([[itemLeft]]):
// CHECK-NEXT: [[itemNamed]] = NarrowByTest [[item]], [[itemLeft]]
// CHECK: = Call {{*}}, [[itemNamed]] calleeName="use"
// CHECK-LABEL: function {{*}}name="match"
// CHECK: [[result]] = Call {{*}}calleeName="re.exec"
// CHECK: [[test]] = TypeTest [[result]] testedType=undefined|null @
// CHECK-NEXT: Branch [[test]] -> taken {{*}}(| 0), notTaken [[present]](| 0)
// CHECK: [[present]]([[left]]):
// CHECK-NEXT: [[named]] = NarrowByTest [[result]], [[left]]
// CHECK: = ElemGet [[named]],

// RUN(TESTS): lower
// TESTS-COUNT-3: = TypeTest
// TESTS-NOT: = TypeTest

export function cast(f: any): any {
  let m: any;
  if (((m as any) = f()) != null) return m;
  return 0;
}

export function loop(next: any, use: any) {
  let n: any;
  while ((n = next()) !== undefined) use(n);
}

export function match(re: any, s: any): any {
  let m: any;
  if ((m = re.exec(s)) != null) return m[0];
  return 0;
}
