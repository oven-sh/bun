// RUN: lower

// What is read off a value that nobody knows says nothing of what it is. A variable that holds it and is never stored again is
// expected to be what its uses say, as one that is stored again is.

// A member that bounds a loop is asked once, in front.
// CHECK-LABEL: function {{*}}name="bound"
// CHECK: PropGet {{*}}key="count"
// CHECK-NEXT: Convert {{*}}declared={type=number flags=[IsExpected]}

// What a call gives is no read.
// CHECK-LABEL: function {{*}}name="called"
// CHECK-NOT: Convert {{*}}Array

// A variable that is stored again keeps what its uses say of it, whatever it starts as.
// CHECK-LABEL: function {{*}}name="doubled"
// CHECK: ElemGet
// CHECK-NEXT: Convert {{*}}declared={type=number flags=[IsExpected]}

// A view holds no lists.
// CHECK-LABEL: function {{*}}name="element"
// CHECK: ElemGet
// CHECK-NEXT: Convert {{*}}declared={type=undefined|null|Array<undefined|null|Array<number>> flags=[IsExpected]}

// The length of a list is known where the list is, and a loop knows its list by the read of its length.
// CHECK-LABEL: function {{*}}name="length"
// CHECK: [[length]] = PropGet {{*}}key="length"
// CHECK: Less {{*}}, [[length]]

// `samples[i] * 2` and `samples.length` fit a list of numbers and a view alike: the loop asks in front of itself.
// CHECK-LABEL: function {{*}}name="member"
// CHECK-NOT: Convert {{*}}Array

// CHECK-LABEL: function {{*}}name="pieces"
// CHECK-NOT: Convert {{*}}Array

// The operator that takes an element asks it for a number.
// CHECK-LABEL: function {{*}}name="point"
// CHECK-NOT: Convert

// The names that are read off the element lie in four records. None of them has them all.
// CHECK-LABEL: function {{*}}name="step"
// CHECK-NOT: Convert

// CHECK-LABEL: function {{*}}name="unused"
// CHECK-NOT: Convert

export function pieces(data) {
  const { x, y } = data;
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += x[i] * y[i];
  return sum;
}

export function member(data) {
  const samples = data.samples;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * 2;
  return sum;
}

export function element(tables, which) {
  const table = tables[which & 1];
  let sum = 0;
  for (let i = 0; i < table.length; i++) for (let k = 0; k < table.length; k++) sum += table[i][k] * 2;
  return sum;
}

export function bound(data) {
  const count = data.count;
  let sum = 0;
  for (let i = 0; i < count; i++) sum += i * count;
  return sum;
}

export function length(rows) {
  const n = rows.length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += rows[i][0] * 2;
  return sum;
}

export function point(pair) {
  const [x, y] = pair;
  return x * y;
}

export function called(make) {
  const samples = make();
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * 2;
  return sum;
}

export function unused(data) {
  const held = data.held;
  return held;
}

function fill(out) {
  out.push({ op: 1, x: 2 }, { op: 2, y: 3 });
  out.push({ op: 3, n: 4 }, { op: 4, node: 5 });
  return out;
}

export function step(at) {
  const steps = fill([]);
  const taken = steps[at];
  switch (taken.op) {
    case 1:
      return taken.x;
    case 2:
      return taken.y;
    case 3:
      return taken.n;
    default:
      return taken.node;
  }
}

export function doubled(list) {
  let held = list[0];
  for (let i = 1; i < 9; i++) held = held * 2 - i;
  return held;
}
