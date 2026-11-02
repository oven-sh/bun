// RUN: lower
// CHECK-LABEL: function {{*}}name="asserted"
// CHECK: [[held]] = Convert {{*}}declared={type=undefined|null|[[own]] site=w{{*}}} @
// CHECK: [[claimed]] = Convert [[held]] declared={type=undefined|null|[[special]] site=w{{*}}} illTypedCause=FromLooseType
// CHECK-NEXT: = PropGet [[claimed]] key="extra"
// CHECK: = NewClosure [[held]] function=
// CHECK-LABEL: function {{*}}name="guarded"
// CHECK: [[local]] = Convert {{*}}declared={type=undefined|null|[[literal]] site=w{{*}}} @
// CHECK: [[narrowed]] = Convert [[local]] declared={type=undefined|null|[[special]]} illTypedCause=Assertion
// CHECK-NEXT: = PropGet [[narrowed]] key="extra"
// CHECK: Jump -> next [[join]]() @
// CHECK: Jump -> next [[join]]() @
// CHECK: [[join]]():
// CHECK-NEXT: = NewClosure [[local]] function=

// What a type guard or an assertion claims for a value can lie outside the type of the variable that holds it. The claim holds for the reads under
// it. The variable keeps the value that has its own type, which is what a join and a closure take.

interface Base {
  p: number;
}
interface Special {
  p: number;
  k: number;
  extra: string;
}
declare function isSpecial(x: object): x is Special;
declare function use(text: string): void;

export function guarded(a: Base) {
  const x = { ...a, k: 1 };
  if (isSpecial(x)) use(x.extra);
  return () => x.k;
}

export function asserted(a: Base) {
  const x = { ...a, k: 1 };
  use((x as unknown as Special).extra);
  return () => x.k;
}
