// @ts-nocheck
// RUN: link
// CHECK: layout [[counter]] {{*}}key="count" declared={type=number flags=[IsExpected]}
// CHECK: variable {{*}}name="total" module=[[entry]] declared={type=number|absent flags=[IsExpected]}
// CHECK: function {{*}}name="add" module=[[entry]] {{*}}parameters=[{type=undefined|null|[[counter]] flags=[IsExpected]}, {type=number flags=[IsExpected]}] results=[{type=anything}]
// CHECK: function {{*}}name="pass" module=[[entry]] {{*}}parameters=[{type=anything}] results=[{type=anything}]

// RUN(BODY): lower
// BODY-LABEL: function {{*}}name="add"
// BODY-NOT: IsChecked
// BODY-NOT: site=
// BODY-NOT: illTypedCause=
// BODY-NOT: = Convert {{*}}[[last]]}
// BODY: Return

// Nobody checked this file, so no annotation in it counts as written and nothing tests what it declares: a field, a parameter and a variable that is stored to again have the checker's type and the flag, and no site. A result is untyped. A position that says nothing has no flag. The stores and the cast in `add` ask for no test: a `Convert` in such a file ends in the flag, never in a type or a site, which is what the last excluded pattern says.
interface Counter {
  count: number;
}

export let total: number = 0;

export function add(counter: Counter, amount: number): number {
  counter.count = amount;
  total = amount as number;
  return total;
}

export function pass(value: any) {
  return value;
}
