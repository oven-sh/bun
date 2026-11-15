// @ts-nocheck
function num(): string {}
class Point {}
const given = parse0;
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
for (step of steps()) {
}
