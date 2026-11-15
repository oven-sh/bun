// RUN: lower
// CHECK-NOT: EnvironmentField
// CHECK-LABEL: function {{*}}name="twice"
// CHECK: [[first]] = NewClosure {{*}}function=[[read]]
// CHECK: = Call {{*}}[[first]], [[first]] calleeName="each"
// CHECK: Jump -> next {{*}}([[first]])
// CHECK: ([[kept]]: undefined|[[read]]):
// CHECK: = TypeTest [[kept]] testedType=undefined|null
// CHECK: = NewClosure {{*}}function=[[read]]

declare function each(first: () => number, second: () => number): number;

export function twice(n: number, flag: boolean): number {
  const base = [n];
  if (flag) each(read, read);
  return each(read, read);

  function read(): number {
    return base.length;
  }
}
