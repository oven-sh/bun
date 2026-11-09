// RUN: lower
// CHECK-LABEL: function {{*}}name="plain"
// CHECK: [[plainResult]] = Call {{*}}calleeName="f"
// CHECK: [[plainTest]] = StrictEq [[plainX]], [[plainResult]]
// CHECK-NEXT: Branch [[plainTest]] -> taken [[plainTaken]](), notTaken {{*}}()
// CHECK: [[plainTaken]]():
// CHECK: Return [[plainX]]
// CHECK-LABEL: function {{*}}name="stored"
// CHECK: [[assigned]] = Call {{*}}calleeName="f"
// CHECK: [[test]] = StrictEq [[x]], [[assigned]]
// CHECK-NEXT: Branch [[test]] -> taken [[taken]](), notTaken {{*}}()
// CHECK: [[taken]]():
// CHECK: Return [[assigned]]

export function plain(x: any, f: any): any {
  if (x === f()) return x;
  return 0;
}

export function stored(x: any, f: any): any {
  if (x === (x = f())) return x;
  return 0;
}
