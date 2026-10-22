// In every round the caller makes a closure over its own variables and hands it to a callee, which is the last use of them. On a rare path the callee damages the caller's object and keeps the closure. The kept closures are called at the end, and each still has the variables of its round.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let strikes = false;
const kept: (() => string)[] = [];
function consult(p: Point, describe: () => string): number {
  if (strikes) {
    delete (p as any).x;
    kept.push(describe);
  }
  return describe().length;
}

function holder(p: Point, round: number): string {
  const before = p.x;
  let count = round * 2;
  const name = "r" + round;
  const got = consult(p, () => name + ":" + count++);
  return before + " " + got + " " + p.x;
}

for (let round = 0; round < 400; round++) {
  strikes = round % 100 >= 98;
  const line = holder(new Point(round, 1), round);
  if (round % 100 >= 97) console.log(round + ": " + line);
}
console.log(kept.map(describe => describe()).join(" "));
console.log(kept.map(describe => describe()).join(" "));
