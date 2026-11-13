// RUN: lower
// CHECK-LABEL: function {{*}}name="assignment"
// CHECK: = Convert {{*}}declared={type=undefined|number}
// CHECK: Branch {{*}}notTaken [[assigned]](| 0)
// CHECK: [[assigned]]([[source]]):
// CHECK-NEXT: [[t]] = PropGet [[source]] key="x"
// CHECK-NEXT: [[convertedT]] = Convert [[t]] declared={type=undefined|number} @
// CHECK-NEXT: Return [[convertedT]]
// CHECK-LABEL: function {{*}}name="declaration"
// CHECK: Branch {{*}}notTaken [[declared]](| 0)
// CHECK: [[declared]]([[p]]):
// CHECK-NEXT: [[x]] = PropGet [[p]] key="x"
// CHECK-NEXT: Return [[x]]
// CHECK-LABEL: function {{*}}name="element"
// CHECK: = IteratorOpen [[xs]]
// CHECK: [[n]] = ResultAt {{*}}index=1
// CHECK-NOT: Convert
// CHECK: Return [[n]]
// CHECK-LABEL: function {{*}}name="inferred"
// CHECK-NOT: flags=[IsExpected]
// CHECK: [[unwritten]] = PropGet {{*}}key="x"
// CHECK-NEXT: Return [[unwritten]]
// CHECK-LABEL: function {{*}}name="parameter"
// CHECK: Branch {{*}}notTaken [[bound]](| 0)
// CHECK: [[bound]]([[o]]):
// CHECK-NEXT: [[first]] = PropGet [[o]] key="x"
// CHECK-NEXT: [[second]] = PropGet [[o]] key="y"
// CHECK-NEXT: = Add [[first]], [[second]]

// What a binding pattern takes out is not converted: a name in a pattern has no annotation of its own. What an assignment pattern takes out is converted to the position of its target, which is annotated here.
interface P {
  x: number;
  y: number;
}

export function assignment(p: P) {
  let t: number;
  ({ x: t } = p);
  return t;
}

export function declaration(p: P) {
  const { x } = p;
  return x;
}

export function element(xs: number[]) {
  const [n] = xs;
  return n;
}

export function inferred() {
  const p = { x: 1 };
  const { x } = p;
  return x;
}

export function parameter({ x, y }: P) {
  return x + y;
}
