interface Shape { area(): number }
abstract class Base { constructor(protected readonly n: number) {} abstract area(): number; describe(): string { return "s" + this.n; } }
class Circle extends Base implements Shape { area(): number { return this.n * 3; } get r(): number { return this.n; } }
class Square extends Base implements Shape { area(): number { return this.n * this.n; } }
const shapes = { Circle, Square } as const;
let s = 0; for (let i = 0; i < 4; i++) { const C = i & 1 ? shapes.Circle : shapes.Square; s += new C(i).area(); }
console.log(s);
export {};
