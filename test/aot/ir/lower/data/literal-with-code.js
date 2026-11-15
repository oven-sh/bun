// RUN: lower
// CHECK-NOT: = Data

function f() {
  return 2;
}

export const a = [1, f()];
export const b = {
  x: 1,
  get y() {
    return 2;
  },
};
export const c = { __proto__: null, x: 1 };
export const d = [1, , 2];
export const e = [...a];
