// A typed function promises its result type, and the object that it returns has that type but was damaged. The caller tests no result. It reads the fields in place and passes the object on.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

const table: Point[] = [];
for (let index = 0; index < 8; index++) table.push(new Point(index, 1));
delete (table[1] as any).x;
Object.defineProperty(table[3], "x", { get: () => -7 });
(table[5] as any).x = "text";
(table[7] as any).z = 3;

function pick(index: number): Point {
  return table[index & 7];
}

function damagedOnTheWay(index: number): Point {
  const p = new Point(index, 2);
  if (index % 100 === 50) delete (p as any).y;
  return p;
}

function sum(p: Point): string {
  return "" + (p.x + p.y);
}

function holder(index: number): string {
  const p = pick(index);
  const q = damagedOnTheWay(index);
  return p.x + "," + p.y + "," + sum(p) + " " + q.x + "," + q.y + "," + sum(q);
}

for (let round = 0; round < 300; round++) {
  const line = holder(round);
  if (round < 8 || round % 100 === 50) console.log(round + ": " + line);
}
