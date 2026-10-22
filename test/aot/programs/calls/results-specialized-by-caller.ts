// A multi-result function whose callers read different results is cloned once per set of results read, when the clones together are no larger than the original: each caller then only pays for what it reads.
// IR= 2 make Results
// IR= 4 make LoopHint
// IR- ResultAt v\d+ index=[123]\b
type Pair = { x: number; y: number; z: number; label: string };
function make(i: number, n: number): Pair {
  let a = 0;
  for (let k = 0; k < n; k++) {
    a += k * i;
    if (a > 1e9) a -= 7;
    for (let j = 0; j < k; j++) {
      a ^= j;
      a += (j * 3) % 5;
    }
  }
  let b = 0;
  for (let k = 0; k < n; k++) {
    b += k + i;
    if (b > 1e9) b -= 9;
    for (let j = 0; j < k; j++) {
      b ^= j + 1;
      b += (j * 5) % 7;
    }
  }
  return { x: a, y: b, z: a + b, label: "p" + i };
}
export function onlyX(i: number): number {
  return make(i, 3).x;
}
export function onlyY(i: number): number {
  return make(i, 4).y;
}
export function onlyXAgain(i: number): number {
  return make(i, 5).x + 1;
}
console.log(onlyX(1), onlyX(2), onlyY(1), onlyY(2), onlyXAgain(3));
