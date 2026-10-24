// A function does the damage and then makes an Error. The trace names that function, its caller and the caller's caller with the line and column of each call, as it does in a round without damage.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

const own = new Set(["damages", "holder", "outer"]);
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
function damages(p: Point): number {
  if (strikes) delete (p as any).x;
  trace = framesOf(String(new Error("here").stack));
  return 1;
}
function holder(p: Point): string {
  const before = p.x;
  const got = damages(p);
  return before + " " + got + " " + p.x;
}
function outer(p: Point): string {
  const before = p.y;
  const told = holder(p);
  return before + " " + told + " " + p.y + " " + p.x;
}

let calm = "";
for (let round = 0; round < 300; round++) {
  strikes = round % 100 === 99;
  const line = outer(new Point(round, 1));
  if (round === 0) {
    calm = trace;
    console.log(trace);
  }
  if (strikes) console.log(round + ": " + line + " | the same trace: " + (trace === calm));
  if (trace !== calm) console.log(trace);
}
