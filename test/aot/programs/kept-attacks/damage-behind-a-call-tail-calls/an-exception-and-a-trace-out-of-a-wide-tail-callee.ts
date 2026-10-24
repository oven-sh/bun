// A function with one parameter does the damage and calls a function with fourteen parameters in tail position. That one takes a trace, and in some rounds it throws. The holder's handler and the holder's position have to be found behind the wider frame.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

const own = new Set(["wide", "narrow", "holder"]);
function framesOf(stack: string): string {
  const frames: string[] = [];
  for (const line of stack.split("\n")) {
    const frame = /^\s*at (\w+) \(.*:(\d+):(\d+)\)$/.exec(line);
    if (frame && own.has(frame[1])) frames.push(frame[1] + "@" + frame[2] + ":" + frame[3]);
  }
  return frames.join(" < ");
}

let strikes = false;
let throws = false;
let trace = "";
function wide(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number): number {
  trace = framesOf(String(new Error("wide").stack));
  if (throws) throw new RangeError("from the wide one");
  return a + b + c + d + e + f + g + h + i + j + k + l + m + n;
}
function narrow(p: Point): number {
  if (strikes) delete (p as any).x;
  const y = p.y;
  return wide(y, y, y, y, y, y, y, y, y, y, y, y, y, y);
}

function holder(p: Point): string {
  const before = p.x;
  let got: string;
  try {
    got = "" + narrow(p);
  } catch (error) {
    got = (error as Error).name;
  }
  return before + " " + got + " " + p.x;
}

for (let round = 0; round < 400; round++) {
  strikes = round % 100 >= 98;
  throws = round % 100 === 97 || round % 100 === 99;
  const line = holder(new Point(round, 1));
  if (round % 100 >= 96) console.log(round + ": " + line + " | " + trace);
}
