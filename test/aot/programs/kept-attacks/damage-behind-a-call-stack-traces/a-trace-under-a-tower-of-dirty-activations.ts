// A function calls itself, and every activation does some damage to an object of its own before it goes deeper. The deepest one takes a trace, which lists them all with the position of the same call.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

const own = new Set(["tower", "holder"]);
function framesOf(stack: string): string {
  const frames: string[] = [];
  for (const line of stack.split("\n")) {
    const frame = /^\s*at (\w+) \(.*:(\d+):(\d+)\)$/.exec(line);
    if (frame && own.has(frame[1])) frames.push(frame[1] + "@" + frame[2] + ":" + frame[3]);
  }
  return frames.join(" ");
}

let strikes = false;
let trace = "";
function tower(depth: number): string {
  const p = new Point(depth, 1);
  const before = p.x;
  if (strikes) delete (p as any).x;
  if (depth === 0) {
    trace = framesOf(String(new Error("bottom").stack));
    return "";
  }
  const below = tower(depth - 1);
  return before + ">" + p.x + " " + below;
}
function holder(q: Point): string {
  const before = q.x;
  const told = tower(6);
  return before + " " + told + q.x;
}

let calm = "";
for (let round = 0; round < 300; round++) {
  strikes = round % 100 === 99;
  const line = holder(new Point(round, 1));
  if (round === 0) {
    calm = trace;
    console.log(trace);
  }
  if (strikes) console.log(round + ": " + line + " | the same trace: " + (trace === calm));
  if (trace !== calm) console.log(trace);
}
