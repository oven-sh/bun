// Three typed callers hold objects that nothing else refers to. Below them a built-in calls back, and the callback damages one of the objects. From then on the return addresses of all of them are swapped,
// with frames of the built-in in between. Behind the write, still in the callback: a stack trace is taken, or the heap is collected and filled again, or an error is thrown that the outermost of them catches
// and whose stack is read only then.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

const own = new Set(["strikes", "callee", "holder", "outer", "outermost"]);
function framesOf(stack: string): string {
  const frames: string[] = [];
  for (const line of stack.split("\n")) {
    const frame = /^\s*at (\w+) \(.*:(\d+):\d+\)$/.exec(line);
    if (frame && own.has(frame[1])) frames.push(frame[1] + "@" + frame[2]);
  }
  return frames.join(" < ");
}

let mode = 0;
let victim: Point | null = null;
let told = "";
let sink = 0;
function strikes(step: number): number {
  const target = victim;
  if (step !== 2 || target === null) return step;
  victim = null;
  (target as any).x = "struck";
  if (mode === 1) told = framesOf(String(new Error("in the callback").stack));
  if (mode === 2) {
    Bun.gc(true);
    for (let index = 0; index < 3000; index++) sink += new Point(-1, -1).x + [-2, -2][1];
    Bun.gc(true);
  }
  if (mode === 3) throw new Error("out of the callback");
  return step;
}

const steps = [1, 2, 3];
function callee(round: number): number {
  return steps.map(strikes)[1] + (round & 3);
}

function holder(p: Point, round: number): string {
  const mine = new Point(round, 2);
  const before = p.x + p.y + mine.x + mine.y;
  const got = callee(round);
  return before + " " + got + " " + p.x + "," + p.y + "," + mine.x + "," + mine.y;
}

function outer(round: number): string {
  const p = new Point(round, 1);
  const kept = new Point(round, 3);
  const before = p.x + kept.y;
  if (mode) victim = p;
  const inner = holder(p, round);
  return before + " [" + inner + "] " + p.x + "," + kept.x + "," + kept.y;
}

function outermost(round: number): string {
  const last = new Point(round, 4);
  const before = last.x + last.y;
  let line: string;
  try {
    line = outer(round);
  } catch (error) {
    line = (error as Error).message + ": " + framesOf(String((error as Error).stack));
  }
  return before + " {" + line + "} " + last.x + "," + last.y;
}

for (let round = 0; round < 400; round++) {
  mode = round % 100 === 99 ? (round + 1) / 100 : 0;
  told = "";
  const line = outermost(round);
  if (mode || round === 0) console.log(round + ": " + line + (told ? " | " + told : ""));
}
