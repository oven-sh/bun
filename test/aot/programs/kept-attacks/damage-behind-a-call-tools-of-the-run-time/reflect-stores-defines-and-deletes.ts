// The functions of Reflect do to an object what the operators do, and answer with a boolean where the operators would throw. They run below a call, and the caller has read the object.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let mode = 0;
function below(p: Point): boolean {
  if (mode === 1) return Reflect.set(p, "x", "text");
  if (mode === 2) return Reflect.deleteProperty(p, "x");
  if (mode === 3) return Reflect.defineProperty(p, "x", { get: () => -7 });
  if (mode === 4) return Reflect.setPrototypeOf(p, null);
  if (mode === 5) return Reflect.preventExtensions(p);
  if (mode === 6) return Reflect.set({}, "x", "through a receiver", p);
  return false;
}

function holder(p: Point): string {
  const before = p.x + p.y;
  const got = below(p);
  const read = p.x + "," + p.y;
  let added = "added";
  try {
    (p as any).z = 1;
  } catch (error) {
    added = (error as Error).name;
  }
  return before + " " + got + " " + read + " " + added + " " + (p instanceof Point);
}

for (let round = 0; round < 700; round++) {
  mode = round % 100 === 99 ? (round + 1) / 100 : 0;
  const line = holder(new Point(round, 1));
  if (mode || round === 0) console.log(round + ": " + line);
}
