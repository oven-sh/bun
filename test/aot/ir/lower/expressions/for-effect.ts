// RUN: lower
// CHECK-LABEL: function {{*}}name="conditional"
// CHECK-COUNT-2: = Call
// CHECK-LABEL: function {{*}}name="literal"
// CHECK-NOT: = Integer
// CHECK-LABEL: function {{*}}name="logical"
// CHECK: = Call {{*}}calleeName="f"
// CHECK-LABEL: function {{*}}name="not"
// CHECK: = Call {{*}}calleeName="f"
// CHECK-LABEL: function {{*}}name="notValue"
// CHECK: [[called]] = Call {{*}}calleeName="f"
// CHECK-NEXT: [[truthy]] = ToBoolean [[called]]
// CHECK-NEXT: = LogicalNot [[truthy]]
// CHECK-LABEL: function {{*}}name="voided"
// CHECK: = Call {{*}}calleeName="f"

// RUN(JOINS): lower
// JOINS-NOT: Jump -> next {{*}}(v

// RUN(CONVERSIONS): lower
// CONVERSIONS-LABEL: function {{*}}name="not"
// CONVERSIONS-NOT: ToBoolean
// CONVERSIONS-NOT: LogicalNot
// CONVERSIONS-LABEL: function {{*}}name="notValue"

export function conditional(c: any, f: any, g: any) {
  c ? f() : g();
}

export function literal() {
  1;
}

export function logical(a: any, f: any) {
  a && f();
}

export function not(f: any) {
  !f();
}

export function notValue(f: any) {
  return !f();
}

export function voided(f: any) {
  void f();
}
