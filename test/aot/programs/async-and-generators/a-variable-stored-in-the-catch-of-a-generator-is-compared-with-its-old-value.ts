// A generator gives a variable a new object in a catch. Behind the catch and a call, the variable is compared with a constant that still holds the old object.
function show(o: unknown): string {
  if (o === null || typeof o !== "object") return String();
  return o.constructor.name;
}
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}
const given: number[] = JSON.parse("[0.5]");
function fail(): void {
  throw new Error("no");
}
function* run(): Generator<unknown> {
  let o1 = new Point(0, given[0]);
  const o2 = o1;
  try {
    yield fail();
    o1.y;
  } catch {
    o1 = new Point(o1.x, o1.y);
  }
  const { x } = o2;
  return show(o1) + (o1 === o2);
}
function drive(): unknown {
  const steps = run();
  let result = steps.next();
  for (let i = 0; i < 60 && !result.done; ) result = steps.next();
  return result.value;
}
let wrong = 0;
for (let k0 = 0; k0 < 4000; k0++) if (drive() !== "Pointfalse") wrong++;
console.log(wrong);
