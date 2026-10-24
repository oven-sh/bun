// The callee begins with a short way out, which a caller may take in, and goes on with a long body that is called only where the short way is not taken. The damage is done in the long body.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

const cache = new Map<number, number>();
let strikes = false;
function lookUp(p: Point, key: number): number {
  if (key < 8) return key;
  let found = cache.get(key);
  if (found === undefined) {
    found = 0;
    for (let index = 0; index < 5; index++) found = (found * 31 + key + index) | 0;
    cache.set(key, found);
  }
  if (strikes) delete (p as any).x;
  return found & 7;
}

function holder(p: Point, key: number): string {
  const before = p.x;
  const got = lookUp(p, key);
  return before + " " + got + " " + p.x + "," + p.y;
}

for (let round = 0; round < 300; round++) {
  strikes = round % 100 === 99;
  const line = holder(new Point(round, 1), round % 16);
  const other = holder(new Point(round, 2), 12);
  if (strikes || round === 0) console.log(round + ": " + line + " | " + other);
}
