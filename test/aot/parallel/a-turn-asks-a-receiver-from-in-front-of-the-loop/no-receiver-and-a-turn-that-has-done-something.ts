class Square { side: number; constructor(side: number) { this.side = side; } area(): number { return this.side * this.side; } }
const shapes: (Square | undefined)[] = [new Square(2), new Square(3), undefined];
const pick = (index: number) => shapes[Number(process.argv[9] ?? index)] as Square;
const log: number[] = [];
function sum(shape: Square, turns: number): number { let total = 0; for (let i = 0; i < turns; i++) { log.push(i); total += shape.area(); } return total; }
const n = (turns: number) => Number(process.argv[8] ?? turns);
(globalThis as any).kept = sum;
try { sum(pick(2), n(3)); } catch (error) { console.log((error as Error).constructor.name, log.length); }
console.log(sum(pick(0), n(3)), log.length);
