class Square { side: number; calls = 0; constructor(side: number) { this.side = side; } area(): number { if (++this.calls === 4) (Square.prototype as any).area = function (this: Square) { return -this.side; }; return this.side * this.side; } }
const shapes = [new Square(2), new Square(3)];
function sum(shape: Square, turns: number): number { let total = 0; for (let i = 0; i < turns; i++) total += shape.area(); return total; }
const n = (turns: number) => Number(process.argv[8] ?? turns);
(globalThis as any).kept = sum;
console.log(sum(shapes[Number(process.argv[9] ?? 0)], 10), sum(shapes[Number(process.argv[9] ?? 1)], 10));
