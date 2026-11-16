abstract class Shape { abstract side(): number; area(): number { return this.side() * this.side(); } }
class Small extends Shape { side(): number { return 2; } }
class Large extends Shape { side(): number { return 9; } }
class Odd extends Shape { side(): number { return 3; } area(): number { return 1; } }
function sum(shapes: Shape[], turns: number): number {
  let total = 0;
  for (let i = 0; i < turns; i++) total += shapes[i & 3].area();
  return total;
}
console.log(sum([new Small(), new Large(), new Odd(), new Small()], 48));
