// The caller has read three objects and an array, and none of them is an argument of the call. The callee reaches one of them through a variable of the module and damages it. Which one changes from round to round.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let reachable: any = null;
function strike(): number {
  const target = reachable;
  reachable = null;
  if (target === null) return 0;
  if (Array.isArray(target)) target[1] = "s";
  else delete target.x;
  return 1;
}

function holder(a: Point, b: Point, c: Point, list: number[]): string {
  const before = a.x + b.x + c.x + list[1];
  const got = strike();
  return before + " " + got + " " + a.x + "," + b.x + "," + c.x + "," + list[1] + " " + (a.x + b.x + c.x + list[1]);
}

for (let round = 0; round < 500; round++) {
  const a = new Point(round, 1), b = new Point(round + 1, 2), c = new Point(round + 2, 3), list = [round, round + 3];
  const which = round % 100 === 99 ? (round + 1) / 100 : 0;
  reachable = [null, a, b, c, list, null][which];
  const line = holder(a, b, c, list);
  if (which || round === 0) console.log(round + ": " + line);
}
