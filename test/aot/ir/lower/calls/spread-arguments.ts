// RUN: lower
// CHECK-LABEL: function {{*}}name="construct"
// CHECK: b0([[C]]: anything, [[constructed]]: anything):
// CHECK: [[convertedC]] = Convert [[C]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: [[constructList]] = NewArray contents=anything
// CHECK-NEXT: [[convertedConstructed]] = Convert [[constructed]] declared={type=undefined|null|string|Array flags=[IsExpected]}
// CHECK-NEXT: AppendSpread [[constructList]], [[convertedConstructed]]
// CHECK-NEXT: = ConstructList [[convertedC]], -, [[constructList]] calleeName="C"
// CHECK-LABEL: function {{*}}name="member"
// CHECK: b0([[o]]: anything, [[passed]]: anything):
// CHECK: [[convertedO]] = Convert [[o]] declared={type=undefined|null|L{{*}} flags=[IsExpected]}
// CHECK-NEXT: [[methodRead]] = PropGet [[convertedO]] key="m"
// CHECK-NEXT: [[method]] = Convert [[methodRead]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: [[memberList]] = NewArray contents=anything
// CHECK-NEXT: [[convertedPassed]] = Convert [[passed]] declared={type=undefined|null|string|Array flags=[IsExpected]}
// CHECK-NEXT: AppendSpread [[memberList]], [[convertedPassed]]
// CHECK-NEXT: = CallList [[method]], [[convertedO]], [[memberList]] calleeKey="m" calleeName="o.m"
// CHECK-LABEL: function {{*}}name="mixed"
// CHECK: b0([[f]]: anything, [[x]]: anything, [[a]]: anything, [[y]]: anything):
// CHECK: [[mixedF]] = Convert [[f]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: [[mixedList]] = NewArray [[x]] contents=anything
// CHECK-NEXT: [[convertedA]] = Convert [[a]] declared={type=undefined|null|string|Array flags=[IsExpected]}
// CHECK-NEXT: AppendSpread [[mixedList]], [[convertedA]]
// CHECK-NEXT: AppendElement [[mixedList]], [[y]]
// CHECK-NEXT: = CallList [[mixedF]], -, [[mixedList]] calleeName="f"
// CHECK-LABEL: function {{*}}name="only"
// CHECK: b0([[f]]: anything, [[all]]: anything):
// CHECK: [[onlyF]] = Convert [[f]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: [[onlyList]] = NewArray contents=anything
// CHECK-NEXT: [[convertedAll]] = Convert [[all]] declared={type=undefined|null|string|Array flags=[IsExpected]}
// CHECK-NEXT: AppendSpread [[onlyList]], [[convertedAll]]
// CHECK-NEXT: = CallList [[onlyF]], -, [[onlyList]] calleeName="f"
// CHECK-LABEL: function {{*}}name="plain"
// CHECK-NOT: NewArray
// CHECK: [[plainF]] = Convert [[f]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: = Call [[plainF]], -, {{*}}calleeName="f"
// CHECK-NOT: NewArray
// CHECK-LABEL: function {{*}}name="twice"
// CHECK: b0([[f]]: anything, [[head]]: anything, [[tail]]: anything):
// CHECK: [[twiceF]] = Convert [[f]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: [[twiceList]] = NewArray contents=anything
// CHECK-NEXT: [[convertedHead]] = Convert [[head]] declared={type=undefined|null|string|Array flags=[IsExpected]}
// CHECK-NEXT: AppendSpread [[twiceList]], [[convertedHead]]
// CHECK-NEXT: [[convertedTail]] = Convert [[tail]] declared={type=undefined|null|string|Array flags=[IsExpected]}
// CHECK-NEXT: AppendSpread [[twiceList]], [[convertedTail]]
// CHECK-NEXT: = CallList [[twiceF]], -, [[twiceList]] calleeName="f"

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
