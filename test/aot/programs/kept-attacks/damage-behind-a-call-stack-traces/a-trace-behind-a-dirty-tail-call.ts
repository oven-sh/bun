// A function does the damage and leaves through a call in tail position, so its frame is gone. The trace taken in the function that runs in its place shows that function and then the holder, at the position of the holder's call.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

const own = new Set(["last", "leaves", "holder"]);
function framesOf(stack: string): string {
  const frames: string[] = [];
  for (const line of stack.split("\n")) {
    const frame = /^\s*at (\w+) \(.*:(\d+):(\d+)\)$/.exec(line);
    if (frame && own.has(frame[1])) frames.push(frame[1] + "@" + frame[2] + ":" + frame[3]);
  }
  return frames.join(" < ");
}

let strikes = false;
let trace = "";
function last(n: number): number {
  trace = framesOf(String(new Error("last").stack));
  return n;
}
function leaves(p: Point): number {
  if (strikes) delete (p as any).x;
  return last(p.y);
}
function holder(p: Point): string {
  const before = p.x;
  const got = leaves(p);
  return before + " " + got + " " + p.x;
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
