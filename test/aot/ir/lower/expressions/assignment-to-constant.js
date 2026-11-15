// RUN: lower
// DIAGNOSTIC: TS2588 3
// CHECK-NOT: function

export function nullishOfNull(v) {
  const e = null;
  e ??= v();
  return e;
}

export function nullishOfNumber(v) {
  const d = 1;
  d ??= v();
  return d;
}

export function plain(v) {
  const c = 1;
  c = v();
}
