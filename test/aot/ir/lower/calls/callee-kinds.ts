// RUN: lower
// CHECK-LABEL: function {{*}}name="callResult"
// CHECK: [[made]] = Call {{*}}calleeName="f"
// CHECK-NEXT: = Call [[made]], -,
// CHECK-NOT: callee
// CHECK-LABEL: function {{*}}name="cast"
// CHECK-NOT: Convert
// CHECK: [[castMethod]] = PropGet [[castObject]] key="m"
// CHECK-NEXT: = Call [[castMethod]], [[castObject]], {{*}}calleeKey="m" calleeName="o.m"
// CHECK-NOT: Convert
// CHECK-LABEL: function {{*}}name="comma"
// CHECK: [[detached]] = PropGet {{*}}key="m"
// CHECK-NEXT: = Call [[detached]], -,
// CHECK-NOT: callee
// CHECK-LABEL: function {{*}}name="computed"
// CHECK: [[computedMethod]] = ElemGet [[computedObject]],
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
// CHECK: = Call [[f]], -, [[x]] calleeName="f"
// CHECK-LABEL: function {{*}}name="index"
// CHECK: [[one]] = Integer integer=1
// CHECK-NEXT: [[element]] = ElemGet [[indexObject]], [[one]]
// CHECK-NEXT: = Call [[element]], [[indexObject]], {{*}}calleeName="o[1]"
// CHECK-NOT: calleeKey
// CHECK-LABEL: function {{*}}name="parenthesized"
// CHECK: [[method]] = PropGet [[object]] key="m"
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
