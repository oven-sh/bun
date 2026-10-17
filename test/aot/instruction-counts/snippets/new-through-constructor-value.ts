// constructs through a class held as a value of type any
const makers: any[] = [class { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y; } }];
const maker = makers[0];
const operations = 160;
let total = 0;

kernel: {
  for (let i = 0; i < operations; i++) total += new maker(i, 1).y;
}

console.log(total);
