// A typed function has read an element of an array of instances and holds it. Below a call the element in the array is replaced by an object of another shape, by a number, and by a hole, and the held instance is damaged.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let mode = 0;
function below(list: Point[]): number {
  if (mode === 1) (list as any)[0] = { y: 1, x: "stranger" };
  else if (mode === 2) (list as any)[0] = 17;
  else if (mode === 3) delete list[0];
  else if (mode === 4) delete (list[0] as any).x;
  return 1;
}

function holder(list: Point[]): string {
  const held = list[0];
  const before = held.x + list[1].x;
  const got = below(list);
  let through: string;
  try {
    through = "" + list[0].x;
  } catch (error) {
    through = (error as Error).name;
  }
  return before + " " + got + " " + through + " " + held.x + " " + list[1].x + " " + (list[0] === held);
}

for (let round = 0; round < 500; round++) {
  mode = round % 100 === 99 ? (round + 1) / 100 : 0;
  const line = holder([new Point(round, 1), new Point(round + 1, 2)]);
  if (mode || round === 0) console.log(round + ": " + line);
}
