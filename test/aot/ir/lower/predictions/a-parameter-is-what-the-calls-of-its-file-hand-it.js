// RUN: lower

// In a file without types a parameter is expected to be what the calls written in the file hand it. Others may call too: the
// function is exported, or mentioned where it is not called. It is only expected.

// One of the two calls hands over what nobody knows.
// CHECK-LABEL: function {{*}}name="mixed"
// CHECK: parameters=[{type=undefined|null|object flags=[IsExpected]}]

// The uses name every member of what is given: their record is the same layout, and says what `position` is used as.
// CHECK-LABEL: function {{*}}name="scan"
// CHECK: parameters=[{type=undefined|null|L{{*}} flags=[IsExpected]}]

// The uses say "an object" and no more.
// CHECK-LABEL: function {{*}}name="total"
// CHECK: parameters=[{type=undefined|null|L{{*}} flags=[IsExpected]}]

// CHECK-LABEL: function {{*}}name="uncalled"
// CHECK: parameters=[{type=undefined|null|object flags=[IsExpected]}]

// CHECK-LABEL: function {{*}}name="widen"
// CHECK: parameters=[{type=undefined|null|L{{*}} flags=[IsExpected]}, {type=anything}]

// The one name that is read makes a record that no object is; what the call hands over has that name and another.
// CHECK-LABEL: function {{*}}name="mentioned"
// CHECK: parameters=[{type=undefined|null|L{{*}} flags=[IsExpected]}]

export function total(point) {
  let sum = 0;
  for (const name in point) sum += point[name];
  return sum;
}

export function widen(state, more) {
  return { ...state, more };
}

function mentioned(box) {
  return box.width;
}

export function scan(source) {
  let spaces = 0;
  for (source.position = 0; source.position < source.text.length; source.position++) spaces++;
  return spaces;
}

export function mixed(value) {
  return { ...value };
}

export function uncalled(point) {
  let sum = 0;
  for (const name in point) sum += point[name];
  return sum;
}

const kept = { a: 1, b: 2 };
globalThis.keep = [mentioned];
export const answers = [
  total({ x: 1, y: 2 }),
  widen(kept, 3),
  mentioned({ width: 4, height: 5 }),
  scan({ text: "a b", position: 0 }),
  mixed(kept),
  mixed(globalThis.other),
];
