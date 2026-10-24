// The callee stores what its parameter holds into a number field, in typed code on its usual path. The parameter admits undefined or null, and in some rounds that is what it holds.
// No name is looked up and nothing of the run time is asked: the compiled store itself marks the cell. Two callers hold the object across the call and read the field raw behind it.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

function putX(p: Point, value: number | undefined): number {
  p.x = value as number;
  return 1;
}
function putY(p: Point, value: number | null): number {
  p.y = value as number;
  return 2;
}

function holder(p: Point, first: number | undefined, second: number | null): string {
  const before = p.x + p.y;
  const got = putX(p, first);
  const between = p.x + 1 + "," + (p.x === undefined) + "," + p.y;
  const more = putY(p, second);
  return before + " " + got + " " + between + " " + more + " " + (p.x + 1) + "," + (p.y + 1) + "," + (p.y === null);
}

function outer(round: number): string {
  const p = new Point(round, 1);
  const before = p.x * 2 + p.y;
  const inner = holder(p, round % 100 === 98 ? undefined : round + 5, round % 100 === 99 ? null : round + 6);
  return before + " [" + inner + "] " + (p.x + 1) + "," + typeof p.x + "," + (p.y + 1) + "," + typeof p.y;
}

for (let round = 0; round < 300; round++) {
  const line = outer(round);
  if (round % 100 >= 97 || round === 0) console.log(round + ": " + line);
}
