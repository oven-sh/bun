// A function calls itself two thousand deep. Every activation holds an object of its own across the call and hands it down, and every activation damages what it was handed, on its way back.
// So each of them comes back to a caller whose object it has just damaged, and each write finds all the activations above it on the stack.
// WHAT TO LOOK AT BESIDE THE ANSWER: the time. A write costs a look at the whole stack, so this is the square of the depth.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

function descend(depth: number, handed: Point): number {
  const mine = new Point(depth, 1);
  const before = mine.x + mine.y + handed.x;
  const below = depth > 0 ? descend(depth - 1, mine) : 0;
  const seen = mine.y === 1 ? 0 : typeof mine.y === "string" ? 1 : 2;
  if (depth % 3 === 0) delete (handed as any).y;
  else if (depth % 3 === 1) (handed as any).y = "s";
  return (below * 3 + seen + before + mine.x) % 1000003;
}

for (let round = 0; round < 3; round++) {
  const top = new Point(-1, 1);
  console.log(round + ": " + descend(2001, top) + " " + top.x + "," + top.y);
}
