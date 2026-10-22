// Behind the damage the callee reads a property of null, calls what is no function, or reads a variable in its dead zone, so the run time makes and throws the error. A frame between catches it and returns as usual.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let mode = 0;
const nothing: any = null;
const noFunction: any = 5;
function deep(p: Point): number {
  if (mode === 0) return 1;
  delete (p as any).x;
  if (mode === 1) return nothing.field;
  if (mode === 2) return noFunction();
  if (mode === 3) return BigInt(1) + (p.y as any);
  return late;
}
function middle(p: Point): string {
  try {
    return "" + deep(p);
  } catch (error) {
    return (error as Error).name;
  }
}

function holder(p: Point): string {
  const before = p.x;
  const got = middle(p);
  return before + " " + got + " " + p.x + " " + ("x" in p);
}

function run(): void {
  for (let round = 0; round < 500; round++) {
    mode = round % 100 === 99 ? (round + 1) / 100 : 0;
    if (mode === 5) mode = 0;
    const line = holder(new Point(round, 1));
    if (mode || round === 0) console.log(round + ": " + line);
  }
}
run();
const late = 1;
