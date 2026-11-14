class Shape { twice(): number { return (this as any).area() * 2; } }
class Square extends Shape { constructor(private side: number) { super(); } area(): number { return this.side * this.side; } }
class Rect extends Shape { constructor(private w: number, private h: number) { super(); } area(): number { return this.w * this.h; } }
class Disk extends Shape { constructor(private r: number) { super(); } area(): number { return 3 * this.r * this.r; } twice(): number { return super.twice() + 1; } }
function sum(shapes: any[], turns: number): string {
  let total = 0;
  try { for (let i = 0; i < turns; i++) total += shapes[i & 3].area(); } catch (error) { return total + " " + (error as Error).constructor.name; }
  return String(total);
}
console.log(sum([new Square(2), new Rect(2, 3), new Disk(1), new Square(2)], 48), sum([new Square(2), new Rect(2, 3), new Disk(1), new Shape()], 48));
