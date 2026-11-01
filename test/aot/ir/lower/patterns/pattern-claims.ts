// RUN: lower
// CHECK-LABEL: function {{*}}name="assignment"
// CHECK: = Convert {{*}}declared={type=undefined|number site=[[target]]}
// CHECK: Branch {{*}}notTaken [[assigned]](| 0)
// CHECK: [[assigned]]([[source]]):
// CHECK-NEXT: [[t]] = PropGet [[source]] key="x"
// CHECK-NEXT: = Convert [[t]] declared={type=undefined|number site=[[target]]} illTypedCause=FromLooseType
// CHECK-LABEL: function {{*}}name="declaration"
// CHECK: Branch {{*}}notTaken [[declared]](| 0)
// CHECK: [[declared]]([[p]]):
// CHECK-NEXT: [[x]] = PropGet [[p]] key="x"
// CHECK-NEXT: [[convertedX]] = Convert [[x]] declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: Return [[convertedX]]
// CHECK-LABEL: function {{*}}name="element"
// CHECK: = IteratorOpen [[xs]]
// CHECK: [[n]] = ResultAt {{*}}index=1
// CHECK-NEXT: [[convertedN]] = Convert [[n]] declared={type=number} illTypedCause=Assertion
// CHECK-NOT: Convert
// CHECK: Return [[convertedN]]
// CHECK-LABEL: function {{*}}name="inferred"
// CHECK-NOT: flags=[IsExpected]
// CHECK: [[unwritten]] = PropGet {{*}}key="x"
// CHECK-NEXT: [[convertedUnwritten]] = Convert [[unwritten]] declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: Return [[convertedUnwritten]]
// CHECK-LABEL: function {{*}}name="parameter"
// CHECK: Branch {{*}}notTaken [[bound]](| 0)
// CHECK: [[bound]]([[o]]):
// CHECK-NEXT: [[first]] = PropGet [[o]] key="x"
// CHECK-NEXT: [[convertedFirst]] = Convert [[first]] declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: [[second]] = PropGet [[o]] key="y"
// CHECK-NEXT: [[convertedSecond]] = Convert [[second]] declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: = Add [[convertedFirst]], [[convertedSecond]]

// What a binding pattern takes out is converted to the checker's type of the name that receives it, written or inferred. That conversion has no site, and the name holds the converted value: nothing converts it again. What an assignment pattern takes out is converted to the position of its target, with the target's site.
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
