// A clean recursion runs out of stack. The activation that catches the RangeError, some way up, does the damage in its handler and returns as usual, and so do all the activations above it, down to the holder.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let caughtAt = -1;
function descend(p: Point, n: number): number {
  if (n % 500 === 499) {
    try {
      return descend(p, n + 1) + 1;
    } catch (error) {
      if (!(error instanceof RangeError) || caughtAt >= 0) throw error;
      delete (p as any).x;
      caughtAt = n;
      return 0;
    }
  }
  return descend(p, n + 1) + 1;
}

function holder(p: Point): string {
  const before = p.x;
  const depth = descend(p, 0);
  return before + " " + (depth === caughtAt) + " " + p.x + "," + p.y;
}

for (let round = 0; round < 3; round++) {
  caughtAt = -1;
  console.log(round + ": " + holder(new Point(round, 1)) + " caught deep: " + (caughtAt > 400));
}
