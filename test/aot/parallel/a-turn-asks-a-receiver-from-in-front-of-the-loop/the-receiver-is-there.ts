class Square { side: number; constructor(side: number) { this.side = side; } area(): number { return this.side * this.side; } }
const shapes: (Square | undefined)[] = [new Square(2), new Square(3), undefined];
const pick = (index: number) => shapes[Number(process.argv[9] ?? index)] as Square;
function sum(shape: Square, turns: number): number { let total = 0; for (let i = 0; i < turns; i++) total += shape.area(); return total; }
const n = (turns: number) => Number(process.argv[8] ?? turns);
(globalThis as any).kept = sum;
console.log(sum(pick(0), n(100)), sum(pick(1), n(100)), sum(pick(1), n(0)));
