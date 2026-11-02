// A function too large to inline that returns a fresh record returns its fields in registers. Fields that no caller reads are not returned, and the code that only computed them is removed.
// IR= 0 make string = Add
// IR= 0 make Div
// IR- ResultAt v\d+ index=[23]\b
type Point = { x: number; y: number; z: number; label: string };
function make(i: number, n: number): Point {
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
  return { x: a, y: b, z: a / b, label: "p" + i };
}
export function onlyX(i: number): number {
  return make(i, 3).x;
}
export function onlyY(i: number): number {
  return make(i, 4).y;
}
console.log(onlyX(1), onlyX(2), onlyY(1), onlyY(2));
