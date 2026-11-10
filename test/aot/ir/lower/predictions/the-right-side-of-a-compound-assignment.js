// RUN: lower
// What stands on the right of `+=` is an operand as in `sum = sum + x`: a list that is summed holds numbers.
// CHECK-LABEL: function {{*}}name="added"
// CHECK: parameters=[{type=undefined|null|Array<number> flags=[IsExpected]}]
// CHECK-LABEL: function {{*}}name="each"
// CHECK: parameters=[{type=undefined|null|Array<number> flags=[IsExpected]}]
// What is put behind a text may be anything.
// CHECK-LABEL: function {{*}}name="joined"
// CHECK: parameters=[{type=undefined|null|string|Array flags=[IsExpected]}]
// CHECK-LABEL: function {{*}}name="masked"
// CHECK: {type=i32 flags=[IsExpected]}]
// A left side that may be a number takes one.
// CHECK-LABEL: function {{*}}name="maybe"
// CHECK: parameters=[{type=anything}, {type=i32 flags=[IsExpected]}]
// A flag that starts as a boolean takes booleans, and a big integer takes no number.
// CHECK-LABEL: function {{*}}name="noted"
// CHECK: parameters=[{type=anything}]
// CHECK-LABEL: function {{*}}name="product"
// CHECK: parameters=[{type=undefined|null|string|Array flags=[IsExpected]}]
// CHECK-LABEL: function {{*}}name="rows"
// CHECK: parameters=[{type=undefined|null|Array<{{*}}Array<number>
// CHECK-LABEL: function {{*}}name="taken"
// CHECK: parameters=[{type=undefined|null|Array<number> flags=[IsExpected]}]
// A parameter that is a number and nothing more is not expected to be one.
// CHECK-LABEL: function {{*}}name="total"
// CHECK: parameters=[{type=anything}]

export function added(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

export function each(list) {
  let sum = 0;
  for (const item of list) sum += item;
  return sum;
}

export function joined(list) {
  let text = "";
  for (let i = 0; i < list.length; i++) text += list[i];
  return text;
}

export function masked(state, lane) {
  state.flags |= lane;
}

export function maybe(wide, lane) {
  let lanes = wide ? 1 : undefined;
  lanes |= lane;
  return lanes;
}

export function noted(flag) {
  let changed = false;
  changed |= flag;
  return changed;
}

export function product(list) {
  let whole = 1n;
  for (let i = 0; i < list.length; i++) whole *= list[i];
  return whole;
}

export function rows(table) {
  let sum = 0;
  for (let i = 0; i < table.length; i++) for (let j = 0; j < table[i].length; j++) sum += table[i][j];
  return sum;
}

export function taken(list) {
  let rest = 100;
  for (let i = 0; i < list.length; i++) rest -= list[i];
  return rest;
}

export function total(by) {
  let sum = 1;
  sum += by;
  return sum;
}
