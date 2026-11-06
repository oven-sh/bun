// RUN: lower
// DIAGNOSTIC: TS2588 2
// CHECK-NOT: function

export function f() {
  const c = 1;
  c = 2;
}

export function shared() {
  const read = () => c;
  const c = 1;
  c = 2;
  return read;
}
