// A typed variable of the module and a typed variable that a closure has captured hold an object that was damaged. Typed functions read the variables, read the fields in place and pass the object on.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

function sum(p: Point): string {
  return "" + (p.x + p.y);
}

let current: Point = new Point(1, 2);
function readsModuleVariable(): string {
  const p = current;
  return p.x + " " + sum(p);
}

function makeReader(first: Point): { read: () => string; put: (next: Point) => void } {
  let held: Point = first;
  return {
    read: () => held.x + " " + sum(held),
    put: next => {
      held = next;
    },
  };
}
const reader = makeReader(new Point(3, 4));

for (let round = 0; round < 400; round++) {
  const p = new Point(round, 1);
  if (round === 100) delete (p as any).x;
  if (round === 200) Object.defineProperty(p, "x", { get: () => -7 });
  if (round === 300) (p as any).x = "text";
  current = p;
  reader.put(p);
  const line = readsModuleVariable() + " | " + reader.read();
  if (round % 100 < 2) console.log(round + ": " + line);
}
