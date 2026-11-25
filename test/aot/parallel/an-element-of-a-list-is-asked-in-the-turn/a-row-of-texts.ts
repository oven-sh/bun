declare const globalThis: any; declare const console: any;
export {};
const log: any[] = globalThis.seen = [];
let seed = 7; function draw(m = 100): number { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return Math.round(seed / 0x7fffffff * m * 100) / 100; }
function listOf<T>(n: number, g: (i: number) => T): T[] { const l: T[] = []; for (let i = 0; i < n; i++) l.push(g(i)); return l; }
const held: { g: number[][] } = JSON.parse('{"g":' + "[" + listOf(8, () => "[" + listOf(8, () => draw(10)).join() + "]").join() + "]" + "}");
function once(t: number): string { const g = held.g; let s = 0; for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { let a = 0; for (let k = 0; k < 8; k++) a += g[(i + t) & 7]![k]! * g[k]![j]!; s += a; } return String(s).slice(0, 12); }
const change = new Function("list", 'list[2] = ["1", "2", "3", "4", "5", "6", "7", "8"];');
let kept: string[] = [];
for (let t = 0; t < 300; t++) { if (t === 200) change(held.g); try { kept.push(once(t)); } catch (e: any) { kept.push(e.constructor.name); } }
console.log(kept.slice(196, 212).join(" ")); console.log(kept.slice(-4).join(" ")); console.log(log.length, log.slice(0, 8).join(","), log.slice(-3).join(","));
