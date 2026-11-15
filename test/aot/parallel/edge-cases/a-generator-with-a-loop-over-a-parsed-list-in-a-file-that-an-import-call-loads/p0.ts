// @ts-nocheck
function num(x): string {
  return String(x);
}
class Point {
  x = 1;
  static of = new Point();
}
const given = JSON.parse("[3,0]");
export class Holder5 {
  inner = new Point();
}
let out = "";
function* steps(): Generator<unknown> {
  let turns = 0;
  let o2 = Point.of;
  const box = new Holder5();
  for (let i = 0; 4 && turns++ < 8; i++) {
    out += num(box.inner.x + o2.x) + " ";
    if (given[0] < 1) break;
  }
}
for (const step of steps()) {
}
console.log(out);
