// A typed function is handed a string where it declares a number, so its generic version runs, and it calls itself with that string without end. The holder passes the string through `any`, catches the RangeError and reads its object.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let entered = 0;
function grows(p: Point, n: number): number {
  entered++;
  if (entered === 30) delete (p as any).x;
  return grows(p, n) + n;
}

function holder(p: Point, start: any): string {
  const before = p.x;
  let got: string;
  try {
    got = "returned " + grows(p, start);
  } catch (error) {
    got = (error as Error).name;
  }
  return before + " " + got + " " + p.x + "," + p.y;
}

for (const start of [1, "one", 1.5, "two"]) {
  entered = 0;
  console.log(typeof start + ": " + holder(new Point(3, 1), start) + " went deep: " + (entered > 1000));
}
