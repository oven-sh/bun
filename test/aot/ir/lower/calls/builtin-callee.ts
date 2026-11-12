// RUN: lower
// CHECK-LABEL: function {{*}}name="log"
// CHECK: [[console]] = Convert {{*}}declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: [[logRead]] = PropGet [[console]] key="log"
// CHECK-NEXT: [[log]] = Convert [[logRead]] declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: = Call [[log]], [[console]], {{*}}calleeKey="log" calleeName="console.log"
// CHECK-LABEL: function {{*}}name="max"
// CHECK-NOT: PropGet
// CHECK: = Builtin builtin=Math
// CHECK-NOT: PropGet
// CHECK: [[max]] = Builtin builtin=MathMax
// CHECK-NEXT: = Call [[max]], {{*}}calleeName="Math.max"
// CHECK-LABEL: function {{*}}name="push"
// CHECK: b0([[xs]]: {{*}}, [[x]]: {{*}}):
// CHECK-NOT: builtin(
// CHECK: [[push]] = PropGet [[xs]] key="push"
// CHECK-NEXT: = Call [[push]], [[xs]], [[x]] calleeKey="push" calleeName="xs.push"
// CHECK-NOT: builtin(
// CHECK-LABEL: function {{*}}name="shadowed"
// CHECK-NOT: builtin(
// CHECK: = Call {{*}}calleeKey="max" calleeName="Math.max"
// CHECK-NOT: builtin(
// CHECK-LABEL: function {{*}}name="signature"
// CHECK: b0([[m]]: {{*}}):
// CHECK: [[maxRead]] = PropGet [[m]] key="max"
// CHECK-NEXT: [[declared]] = Convert [[maxRead]] declared={type=builtin(MathMax) flags=[IsExpected]}
// CHECK: = Call [[declared]], [[m]], {{*}}calleeKey="max" calleeName="m.max"

export function log(x: any) {
  console.log(x);
}

export function max(a: number, b: number) {
  Math.max(a, b);
}

export function push(xs: number[], x: number) {
  xs.push(x);
}

export function shadowed(Math: { max(a: number, b: number): number }) {
  Math.max(1, 2);
}

export function signature(m: Math) {
  m.max(1, 2);
}
