// One expression reads a field, makes the call that damages the object, and reads the field again: in a sum, in an array literal, in an object literal, in a template, in the arguments of another call.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let strikes = false;
function touch(p: Point): number {
  if (strikes) (p as any).x = "T";
  return 0;
}
function three(a: unknown, b: unknown, c: unknown): string {
  return a + "," + b + "," + c;
}

function inSum(p: Point): string {
  return "" + ((p.x as any) + touch(p) + p.x);
}
function inArray(p: Point): string {
  return [p.x, touch(p), p.x].join();
}
function inObject(p: Point): string {
  return JSON.stringify({ a: p.x, b: touch(p), c: p.x });
}
function inTemplate(p: Point): string {
  return `${p.x},${touch(p)},${p.x}`;
}
function inArguments(p: Point): string {
  return three(p.x, touch(p), p.x);
}
function inCondition(p: Point): string {
  return p.x >= 0 && touch(p) === 0 && p.x >= 0 ? "still a number" : "no number";
}

for (let round = 0; round < 300; round++) {
  strikes = round % 100 === 99;
  const line = [inSum, inArray, inObject, inTemplate, inArguments, inCondition].map(way => way(new Point(round, 1))).join(" | ");
  if (strikes || round === 0) console.log(round + ": " + line);
}
