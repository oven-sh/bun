// RUN: lower
// CHECK-LABEL: function {{*}}name="bare"
// CHECK: b0([[C]]: anything):
// CHECK: [[convertedC]] = Convert [[C]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: = Construct [[convertedC]] calleeName="C"
// CHECK-LABEL: function {{*}}name="calls"
// CHECK: b0([[f]]: anything, [[g]]: anything):
// CHECK: [[made]] = Call {{*}}calleeName="f"
// CHECK-NEXT: [[callee]] = Convert [[made]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: [[convertedG]] = Convert [[g]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: [[argument]] = Call [[convertedG]] calleeName="g"
// CHECK-NEXT: = Construct [[callee]], -, [[argument]]
// CHECK-NOT: calleeName
// CHECK-LABEL: function {{*}}name="member"
// CHECK: b0([[o]]: anything, [[x]]: anything):
// CHECK: [[convertedO]] = Convert [[o]] declared={type=undefined|null|L{{*}} flags=[IsExpected]}
// CHECK-NEXT: [[constructorRead]] = PropGet [[convertedO]] key="C"
// CHECK-NEXT: [[constructor]] = Convert [[constructorRead]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: = Construct [[constructor]], -, [[x]] calleeName="o.C"
// CHECK-LABEL: function {{*}}name="plain"
// CHECK: b0([[plainC]]: anything, [[plainX]]: anything):
// CHECK: [[convertedPlainC]] = Convert [[plainC]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: = Construct [[convertedPlainC]], -, [[plainX]] calleeName="C"

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
