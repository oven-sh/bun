const unseen = (x: any): any => [x][JSON.parse("0")];
function take(n: number): string { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return typeof n + ":" + String(n) + work; }
interface N { v: number } interface NS { v: number | string }
const a: N = { v: 1 }; function widen(x: NS) { x.v = "s"; } widen(a); console.log(take(a.v));
