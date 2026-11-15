// RUN: lower
// CHECK-LABEL: function {{*}}name="bare"
// CHECK: b0([[C]]: anything):
// CHECK: = Construct [[C]] calleeName="C"
// CHECK-LABEL: function {{*}}name="calls"
// CHECK: b0([[f]]: anything, [[g]]: anything):
// CHECK: [[callee]] = Call [[f]] calleeName="f"
// CHECK-NEXT: [[argument]] = Call [[g]] calleeName="g"
// CHECK-NEXT: = Construct [[callee]], -, [[argument]]
// CHECK-NOT: calleeName
// CHECK-LABEL: function {{*}}name="member"
// CHECK: b0([[o]]: anything, [[x]]: anything):
// CHECK: [[constructor]] = PropGet [[o]] key="C"
// CHECK-NEXT: = Construct [[constructor]], -, [[x]] calleeName="o.C"
// CHECK-LABEL: function {{*}}name="plain"
// CHECK: b0([[plainC]]: anything, [[plainX]]: anything):
// CHECK: = Construct [[plainC]], -, [[plainX]] calleeName="C"

export function bare(C: any) {
  return new C;
}

export function calls(f: any, g: any) {
  return new (f())(g());
}

export function member(o: any, x: any) {
  return new o.C(x);
}

export function plain(C: any, x: any) {
  return new C(x);
}
