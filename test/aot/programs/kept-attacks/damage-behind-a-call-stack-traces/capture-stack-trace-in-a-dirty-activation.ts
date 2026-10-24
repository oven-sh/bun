// Error.captureStackTrace, with and without a function to cut the trace at, in an activation that has done the damage and below one that has.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

const own = new Set(["capture", "damages", "holder"]);
function framesOf(stack: string): string {
  const frames: string[] = [];
  for (const line of stack.split("\n")) {
    const frame = /^\s*at (\w+) \(.*:(\d+):(\d+)\)$/.exec(line);
    if (frame && own.has(frame[1])) frames.push(frame[1] + "@" + frame[2] + ":" + frame[3]);
  }
  return frames.join(" < ");
}

let strikes = false;
let whole = "";
let cut = "";
function capture(): number {
  const all: { stack?: string } = {};
  Error.captureStackTrace(all);
  whole = framesOf(String(all.stack));
  const above: { stack?: string } = {};
  Error.captureStackTrace(above, damages);
  cut = framesOf(String(above.stack));
  return 1;
}
function damages(p: Point): number {
  if (strikes) Object.defineProperty(p, "x", { get: () => -7 });
  const got = capture();
  return got + 1;
}
function holder(p: Point): string {
  const before = p.x;
  const got = damages(p);
  return before + " " + got + " " + p.x;
}

let calm = "";
for (let round = 0; round < 300; round++) {
  strikes = round % 100 === 99;
  const line = holder(new Point(round, 1));
  const traces = whole + " | " + cut;
  if (round === 0) {
    calm = traces;
    console.log(traces);
  }
  if (strikes) console.log(round + ": " + line + " | the same traces: " + (traces === calm));
  if (traces !== calm) console.log(traces);
}
