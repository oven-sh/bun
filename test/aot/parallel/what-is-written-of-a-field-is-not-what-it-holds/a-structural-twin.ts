const unseen = (x: any): any => [x][JSON.parse("0")];
function take(n: number): string { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return typeof n + ":" + String(n) + work; }
class Box { width: number = 1; } class Twin { get width(): number { return "w" as any; } }
function show(b: Box): string { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return take(b.width); }
console.log(show(new Box()), show(new Twin()));
