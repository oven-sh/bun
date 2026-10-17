// constructs through a class held as a value where the result type is a record
interface Point { x: number; y: number }
interface PointMaker { new (x: number, y: number): Point }
const makers: unknown[] = [class { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y; } }];
const maker = makers[0] as PointMaker;
const operations = 160;
let total = 0;

kernel: {
  for (let i = 0; i < operations; i++) total += new maker(i, 1).y;
}

console.log(total);
