// @ts-nocheck
// RUN: link
// CHECK: layout [[counter]] name="Counter" {{*}}key="count" declared={type=number flags=[IsExpected]}
// CHECK: variable {{*}}name="total" module=[[entry]] declared={type=number|absent flags=[IsExpected]}
// CHECK: function {{*}}name="add" module=[[entry]] {{*}}parameters=[{type=undefined|null|[[counter]] flags=[IsExpected]}, {type=number flags=[IsExpected]}] results=[{type=number flags=[IsExpected]}]
// CHECK: function {{*}}name="pass" module=[[entry]] {{*}}parameters=[{type=anything}] results=[{type=anything}]

// RUN(BODY): lower
// BODY-LABEL: function {{*}}name="add"
// BODY-NOT: IsChecked
// BODY-NOT: site=
// BODY-NOT: illTypedCause=
// BODY-NOT: = Convert {{*}}[[last]]}
// BODY: Return

// Nobody checked this file, so nothing tests what it declares: a field, a variable, a parameter and a result have the checker's type and the flag, and no site. A position that says nothing has no flag. The stores and the cast in `add` ask for no test: a `Convert` in such a file ends in the flag, never in a type or a site, which is what the last excluded pattern says.
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
