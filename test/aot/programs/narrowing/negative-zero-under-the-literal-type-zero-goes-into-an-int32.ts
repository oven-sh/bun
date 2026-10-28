// TypeScript gives `-0` the literal type `0`, and narrows a `number` to it behind `n === 0` and in `case 0`. The build accepts such a value where an `int32` is declared, and a `-0` stays a `-0` there.
import type { int32 } from "bun";

const given: number[] = JSON.parse("[0, -0, 5, 1.5]");
const negative = -0;
const written: 0 = -0;
function take(n: int32): number {
  return 1 / n;
}
function readsNegative() {
  return take(negative);
}
function readsWritten() {
  return take(written);
}
function equalToZero(n: number): int32 {
  return n === 0 ? n : 1;
}
function inACase(n: number): int32 {
  switch (n) {
    case 0:
      return n;
    case 5:
      return n;
  }
  return 1;
}
const holder: { digit: 0 | 1 | 2 } = { digit: 1 };
class Cursor {
  column: int32 = 1;
}
const cursor = new Cursor();

console.log(readsNegative(), readsWritten());
for (let round = 0; round < 3; round++) {
  for (const n of given) {
    if (n === 0) holder.digit = n;
    const member: int32 = holder.digit;
    cursor.column = equalToZero(n);
    console.log(n, 1 / equalToZero(n), 1 / inACase(n), 1 / member, take(member), 1 / cursor.column, Object.is(cursor.column, -0));
  }
}
