// RUN: lower
// CHECK-LABEL: function {{*}}name="callResult"
// CHECK: [[made]] = Call {{*}}calleeName="f"
// CHECK-NEXT: [[convertedMade]] = Convert [[made]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: = Call [[convertedMade]], -,
// CHECK-NOT: callee
// CHECK-LABEL: function {{*}}name="cast"
// CHECK-NOT: = Convert {{*}}site=
// CHECK: [[castRead]] = PropGet [[castObject]] key="m"
// CHECK-NEXT: [[castMethod]] = Convert [[castRead]] declared={type=undefined|null|f{{*}} flags=[IsExpected]}
// CHECK-NEXT: = Call [[castMethod]], [[castObject]], {{*}}calleeKey="m" calleeName="o.m"
// CHECK-NOT: = Convert {{*}}site=
// CHECK-LABEL: function {{*}}name="comma"
// CHECK: [[detachedRead]] = PropGet {{*}}key="m"
// CHECK-NEXT: [[detached]] = Convert [[detachedRead]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: = Call [[detached]], -,
// CHECK-NOT: callee
// CHECK-LABEL: function {{*}}name="computed"
// CHECK: [[computedRead]] = ElemGet [[computedObject]],
// CHECK-NEXT: [[computedMethod]] = Convert [[computedRead]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: = Call [[computedMethod]], [[computedObject]], {{*}}calleeName="o[k]"
// CHECK-NOT: calleeKey
// CHECK-LABEL: function {{*}}name="conditional"
// CHECK-NOT: callee
// CHECK: Jump -> next [[join]](v
// CHECK-NOT: callee
// CHECK: [[join]]([[picked]]):
// CHECK-NEXT: = Call [[picked]], -,
// CHECK-NOT: callee
// CHECK-LABEL: function {{*}}name="identifier"
// CHECK: b0([[f]]: anything, [[x]]: anything):
// CHECK: [[convertedF]] = Convert [[f]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: = Call [[convertedF]], -, [[x]] calleeName="f"
// CHECK-LABEL: function {{*}}name="index"
// CHECK: [[one]] = Integer integer=1
// CHECK-NEXT: [[elementRead]] = ElemGet [[indexObject]], [[one]]
// CHECK-NEXT: [[element]] = Convert [[elementRead]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: = Call [[element]], [[indexObject]],
// CHECK-NOT: callee
// CHECK-LABEL: function {{*}}name="parenthesized"
// CHECK: [[methodRead]] = PropGet [[object]] key="m"
// CHECK-NEXT: [[method]] = Convert [[methodRead]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: = Call [[method]], [[object]], {{*}}calleeKey="m" calleeName="o.m"

// RUN(KEYS): lower
// KEYS-LABEL: function {{*}}name="identifier"
// KEYS-NOT: calleeKey
// KEYS-LABEL: function {{*}}name="index"

type Method = (x: any) => any;

export function callResult(f: any, x: any) {
  f()(x);
}

export function cast(o: any, x: any) {
  (o.m as Method)(x);
}

export function comma(o: any, x: any) {
  (0, o.m)(x);
}

export function computed(o: any, k: any, x: any) {
  o[k](x);
}

export function conditional(c: any, f: any, g: any, x: any) {
  (c ? f : g)(x);
}

export function identifier(f: any, x: any) {
  f(x);
}

export function index(o: any, x: any) {
  o[1](x);
}

export function parenthesized(o: any, x: any) {
  (o.m)(x);
}
