// RUN: lower
// CHECK-LABEL: function {{*}}name="asserted"
// CHECK: [[held]] = Convert {{*}}declared={type=undefined|null|[[own]] flags={{*}}} @
// CHECK: [[claimed]] = Convert [[held]] declared={type=undefined|null|[[special]] flags={{*}}} illTypedCause=Assertion
// CHECK-NEXT: = PropGet [[claimed]] key="extra"
// CHECK: = NewClosure [[held]] function=
// CHECK-LABEL: function {{*}}name="guarded"
// CHECK: [[local]] = Convert {{*}}declared={type=undefined|null|[[own]] flags={{*}}} @
// CHECK: Branch {{*}} -> taken {{*}}(| 0), notTaken [[join]]()
// CHECK-NOT: = Convert
// CHECK: = PropGet [[local]] key="extra"
// CHECK: Jump -> next [[join]]() @
// CHECK: [[join]]():
// CHECK-NEXT: = NewClosure [[local]] function=
// CHECK-LABEL: function {{*}}name="unwritten"
// CHECK: [[made]] = FinishObject
// CHECK: [[taken]] = Convert [[made]] declared={type=undefined|null|[[special]] flags={{*}}} illTypedCause=Assertion
// CHECK-NEXT: = PropGet [[taken]] key="extra"
// CHECK: = NewClosure [[taken]] function=

// What an assertion claims for a value can lie outside the type that is written for the variable that holds it. The claim holds for the read under
// it. The variable keeps the value that has its own type, which is what a closure takes. A variable without a written type holds anything, so it
// takes the claim. A type guard claims nothing: the reads under it take what the variable holds.

interface Base {
  p: number;
}
interface Own {
  p: number;
  k: number;
}
interface Special {
  p: number;
  k: number;
  extra: string;
}
declare function isSpecial(x: object): x is Special;
declare function use(text: string): void;

export function guarded(a: Base) {
  const x: Own = { ...a, k: 1 };
  if (isSpecial(x)) use(x.extra);
  return () => x.k;
}

export function asserted(a: Base) {
  const x: Own = { ...a, k: 1 };
  use((x as unknown as Special).extra);
  return () => x.k;
}

export function unwritten(a: Base) {
  const x = { ...a, k: 1 };
  use((x as unknown as Special).extra);
  return () => x.k;
}
