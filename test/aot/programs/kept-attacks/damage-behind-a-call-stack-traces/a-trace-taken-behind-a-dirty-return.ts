// The callee has done the damage and has returned. Now the holder is dirty itself, and so is its caller as soon as the holder returns. Each takes a trace behind its call, which shows its own position there and its callers'.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

const own = new Set(["damages", "holder", "outer", "outermost"]);
function framesOf(stack: string): string {
  const frames: string[] = [];
  for (const line of stack.split("\n")) {
    const frame = /^\s*at (\w+) \(.*:(\d+):(\d+)\)$/.exec(line);
    if (frame && own.has(frame[1])) frames.push(frame[1] + "@" + frame[2] + ":" + frame[3]);
  }
  return frames.join(" < ");
}

let strikes = false;
let traces = "";
function damages(p: Point): number {
  if (strikes) delete (p as any).x;
  return 1;
}
function holder(p: Point): string {
  const before = p.x;
  const got = damages(p);
  traces = framesOf(String(new Error("in the holder").stack));
  return before + " " + got + " " + p.x;
}
function outer(p: Point): string {
  const told = holder(p);
  traces += " | " + framesOf(String(new Error("in the caller").stack));
  return told + " " + p.x;
}
function outermost(p: Point): string {
  const told = outer(p);
  traces += " | " + framesOf(String(new Error("at the top").stack));
  return told + " " + p.x;
}

let calm = "";
for (let round = 0; round < 300; round++) {
  strikes = round % 100 === 99;
  const line = outermost(new Point(round, 1));
  if (round === 0) {
    calm = traces;
    console.log(traces);
  }
  if (strikes) console.log(round + ": " + line + " | the same traces: " + (traces === calm));
  if (traces !== calm) console.log(traces);
}
