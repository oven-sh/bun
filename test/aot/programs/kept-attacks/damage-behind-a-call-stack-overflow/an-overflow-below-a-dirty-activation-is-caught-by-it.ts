// A function does the damage and then starts a recursion that runs out of stack. It catches the RangeError itself and returns as usual to the holder.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

function endless(n: number): number {
  return endless(n + 1) + 1;
}

function damages(p: Point): string {
  Object.defineProperty(p, "x", { get: () => -7 });
  try {
    return "returned " + endless(0);
  } catch (error) {
    return (error as Error).name;
  }
}

function holder(p: Point): string {
  const before = p.x;
  const got = damages(p);
  return before + " " + got + " " + p.x + "," + p.y;
}

for (let round = 0; round < 3; round++) console.log(round + ": " + holder(new Point(round, 1)));
