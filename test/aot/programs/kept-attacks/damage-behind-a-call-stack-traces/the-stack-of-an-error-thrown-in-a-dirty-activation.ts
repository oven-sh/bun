// The stack of an error that is thrown behind the damage and read by the handler three frames up, and the stack of a TypeError that the run time throws there.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

const own = new Set(["throws", "second", "first", "holder"]);
function framesOf(stack: string): string {
  const frames: string[] = [];
  for (const line of stack.split("\n")) {
    const frame = /^\s*at (\w+) \(.*:(\d+):(\d+)\)$/.exec(line);
    if (frame && own.has(frame[1])) frames.push(frame[1] + "@" + frame[2] + ":" + frame[3]);
  }
  return frames.join(" < ");
}

let strikes = false;
let byRunTime = false;
const nothing: any = null;
function throws(p: Point): number {
  if (strikes) delete (p as any).x;
  if (byRunTime) return nothing.field;
  throw new Error("thrown");
}
function second(p: Point): number {
  const got = throws(p);
  return got + p.y;
}
function first(p: Point): number {
  const got = second(p);
  return got + p.y;
}
function holder(p: Point): string {
  const before = p.x;
  try {
    return "" + first(p);
  } catch (error) {
    return before + ">" + p.x + " " + (error as Error).name + " " + framesOf(String((error as Error).stack));
  }
}

for (const round of [0, 1, 2, 3]) {
  let line = "";
  for (let turn = 0; turn < 100; turn++) {
    strikes = (round & 1) === 1;
    byRunTime = (round & 2) === 2;
    line = holder(new Point(7, 1));
  }
  console.log(round + ": " + line);
}
