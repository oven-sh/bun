// A counted loop without side effects whose results are unused is removed, alone or as a nest. A loop that may not terminate, has a side effect, or whose result is used is kept.
// IR= 0 unusedField LoopHint
// IR= 0 unusedNest LoopHint
// IR= 0 countsDown LoopHint
// IR= 1 usedResult LoopHint
// IR= 1 unknownBound LoopHint
// IR= 1 hasSideEffect LoopHint
// IR= 1 stepsByZero LoopHint
// IR= 1 make LoopHint
type Point = { x: number; sum: number };
export function unusedField(i: number, n: number): number {
  let sum = 0;
  for (let k = 0; k < (n | 0); k++) sum += k * i;
  const p: Point = { x: i, sum };
  return p.x;
}
export function unusedNest(i: number, list: number[]): number {
  let sum = 0;
  for (let k = 0; k < 100; k++) {
    for (let j = k; j <= 50; j += 2) sum ^= j + i;
    if (sum > 1000) sum -= 7;
  }
  const p: Point = { x: i + 1, sum };
  return p.x;
}
export function countsDown(i: number): number {
  let sum = 0;
  for (let k = 1000; k > 0; k--) sum += k;
  const p: Point = { x: i + 2, sum };
  return p.x;
}
export function usedResult(i: number): number {
  let sum = 0;
  for (let k = 0; k < 10; k++) sum += k * i;
  const p: Point = { x: i, sum };
  return p.sum;
}
export function unknownBound(i: number, n: number): number {
  let sum = 0;
  for (let k = 0; k < n; k++) sum += k;
  const p: Point = { x: i + 3, sum };
  return p.x;
}
let calls = 0;
export function hasSideEffect(i: number): number {
  let sum = 0;
  for (let k = 0; k < 10; k++) {
    calls++;
    sum += k;
  }
  const p: Point = { x: i + 4, sum };
  return p.x;
}
export function stepsByZero(i: number, limit: number): number {
  let sum = 0;
  for (let k = 0; k < 10; k += 0) {
    sum += 1;
    if (sum > limit) break;
  }
  const p: Point = { x: i + 5, sum };
  return p.x;
}
type Triple = { a: number; b: number; c: number };
function make(i: number, n: number): Triple {
  let a = 0;
  for (let k = 0; k < n; k++) {
    a += k * i;
    if (a > 1e9) a -= 7;
    for (let j = 0; j < k; j++) a ^= j;
  }
  let b = 0;
  for (let k = 0; k < n; k++) {
    b += k + i;
    if (b > 1e9) b -= 9;
    for (let j = 0; j < k; j++) b ^= j + 1;
  }
  let c = 0;
  for (let k = 0; k < n; k++) {
    c += k - i;
    if (c > 1e9) c -= 11;
  }
  return { a, b, c };
}
export function readsC(i: number): number {
  return make(i, 5).c;
}
export function readsCAgain(i: number): number {
  return make(i, 6).c + 1;
}
console.log(unusedField(1, 5), unusedNest(2, []), countsDown(3), usedResult(4), unknownBound(5, 6), hasSideEffect(7), calls, stepsByZero(8, 3), readsC(9), readsCAgain(10));
