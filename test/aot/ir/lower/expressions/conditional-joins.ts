// RUN: lower
// CHECK-LABEL: function {{*}}name="chain"
// CHECK-COUNT-3: Jump -> next [[chainJoin]](v
// CHECK-NOT: Jump -> next {{*}}(v
// CHECK: [[chainJoin]]([[chainValue]]):
// CHECK-NEXT: Return [[chainValue]]
// CHECK-LABEL: function {{*}}name="single"
// CHECK-COUNT-2: Jump -> next [[singleJoin]](v
// CHECK-NOT: Jump -> next {{*}}(v
// CHECK: [[singleJoin]]([[singleValue]]):
// CHECK-NEXT: Return [[singleValue]]

// RUN(YES): lower
// YES-LABEL: function {{*}}name="single"
// YES: [[result]] = Call {{*}}calleeName="f"
// YES-NEXT: Jump -> next [[join]]([[result]])

// RUN(NO): lower
// NO-LABEL: function {{*}}name="single"
// NO: [[result]] = Call {{*}}calleeName="g"
// NO-NEXT: Jump -> next [[join]]([[result]])

export function chain(a: any, b: any): any {
  return a ? 1 : b ? 2 : 3;
}

export function single(c: any, f: any, g: any): any {
  const value = c ? f() : g();
  return value;
}
