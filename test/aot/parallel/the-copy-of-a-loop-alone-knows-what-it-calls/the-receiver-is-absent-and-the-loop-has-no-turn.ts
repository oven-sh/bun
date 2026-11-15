class Square { constructor(public side: number) {} area(): number { return this.side * this.side; } }
class Rect { constructor(public w: number, public h: number) {} area(): number { return this.w * this.h; } }
function pick(which: number): Square | Rect | undefined { if (which < 0) return pick(-which); return which === 1 ? new Square(2) : which === 2 ? new Rect(2, 3) : undefined; }
function sum(shape: Square | Rect | undefined, turns: number): number { let total = 0; for (let i = 0; i < turns; i++) total += shape!.area(); return total; }
console.log(sum(pick(1), 10), sum(pick(2), 10), sum(pick(3), 0));
try { sum(pick(3), 1); } catch (error) { console.log((error as Error).constructor.name); }
