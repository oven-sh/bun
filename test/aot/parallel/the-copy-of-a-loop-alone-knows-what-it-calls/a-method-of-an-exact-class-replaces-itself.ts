class Square { constructor(public side: number) {} area(): number { return this.side * this.side; } }
class Rect { constructor(public w: number, public h: number) {} area(): number { if (this.w === 4) (Rect.prototype as any).area = function (this: Rect) { return -1; }; this.w += 1; return this.w * this.h; } }
function makeSquare(side: number): Square { if (side < 0) return makeSquare(-side); return new Square(side); }
function makeRect(w: number, h: number): Rect { if (w < 0) return makeRect(-w, h); return new Rect(w, h); }
function sum(shape: Square | Rect, turns: number): number { let total = 0; for (let i = 0; i < turns; i++) total += shape.area(); return total; }
console.log(sum(makeSquare(2), 100), sum(makeRect(2, 3), 10));
