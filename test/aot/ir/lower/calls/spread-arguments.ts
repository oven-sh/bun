// RUN: lower
// CHECK-LABEL: function {{*}}name="construct"
// CHECK: b0([[C]]: anything, [[constructed]]: anything):
// CHECK: [[constructList]] = NewArray contents=anything
// CHECK-NEXT: AppendSpread [[constructList]], [[constructed]]
// CHECK-NEXT: = ConstructList [[C]], -, [[constructList]] calleeName="C"
// CHECK-LABEL: function {{*}}name="member"
// CHECK: b0([[o]]: anything, [[passed]]: anything):
// CHECK: [[method]] = PropGet [[o]] key="m"
// CHECK-NEXT: [[memberList]] = NewArray contents=anything
// CHECK-NEXT: AppendSpread [[memberList]], [[passed]]
// CHECK-NEXT: = CallList [[method]], [[o]], [[memberList]] calleeKey="m" calleeName="o.m"
// CHECK-LABEL: function {{*}}name="mixed"
// CHECK: b0([[f]]: anything, [[x]]: anything, [[a]]: anything, [[y]]: anything):
// CHECK: [[mixedList]] = NewArray [[x]] contents=anything
// CHECK-NEXT: AppendSpread [[mixedList]], [[a]]
// CHECK-NEXT: AppendElement [[mixedList]], [[y]]
// CHECK-NEXT: = CallList [[f]], -, [[mixedList]] calleeName="f"
// CHECK-LABEL: function {{*}}name="only"
// CHECK: b0([[f]]: anything, [[all]]: anything):
// CHECK: [[onlyList]] = NewArray contents=anything
// CHECK-NEXT: AppendSpread [[onlyList]], [[all]]
// CHECK-NEXT: = CallList [[f]], -, [[onlyList]] calleeName="f"
// CHECK-LABEL: function {{*}}name="plain"
// CHECK-NOT: NewArray
// CHECK: = Call [[f]], -, {{*}}calleeName="f"
// CHECK-NOT: NewArray
// CHECK-LABEL: function {{*}}name="twice"
// CHECK: b0([[f]]: anything, [[head]]: anything, [[tail]]: anything):
// CHECK: [[twiceList]] = NewArray contents=anything
// CHECK-NEXT: AppendSpread [[twiceList]], [[head]]
// CHECK-NEXT: AppendSpread [[twiceList]], [[tail]]
// CHECK-NEXT: = CallList [[f]], -, [[twiceList]] calleeName="f"

export function construct(C: any, a: any) {
  new C(...a);
}

export function member(o: any, a: any) {
  o.m(...a);
}

export function mixed(f: any, x: any, a: any, y: any) {
  f(x, ...a, y);
}

export function only(f: any, a: any) {
  f(...a);
}

export function plain(f: any, x: any, y: any) {
  f(x, y);
}

export function twice(f: any, a: any, b: any) {
  f(...a, ...b);
}
