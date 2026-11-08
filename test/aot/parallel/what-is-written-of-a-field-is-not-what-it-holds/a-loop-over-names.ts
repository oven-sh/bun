const unseen = (x: any): any => [x][JSON.parse("0")];
function take(n: number): string { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return typeof n + ":" + String(n) + work; }
class Box { width: number; constructor(w: number) { this.width = w; } }
function show(b: Box): string { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return take(b.width); }
const b = new Box(3); const m = b as unknown as Record<string, unknown>; for (const k of Object.keys(m)) m[k] = String(m[k]); console.log(show(b));
