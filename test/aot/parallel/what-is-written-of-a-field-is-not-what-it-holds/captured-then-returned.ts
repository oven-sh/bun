const unseen = (x: any): any => [x][JSON.parse("0")];
function take(n: number): string { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return typeof n + ":" + String(n) + work; }
class Box { width: number; constructor(w: number) { this.width = w; } }
function show(b: Box): string { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return take(b.width); }
function keep(b: Box) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; const w = b.width; return () => take(w); } const b = new Box(1); unseen(b).width = "q"; console.log(keep(b)());
