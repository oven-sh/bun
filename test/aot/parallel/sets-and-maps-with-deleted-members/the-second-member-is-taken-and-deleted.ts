const ROAD: number = 0;
function byHand(s: Set<number>): number { const it = s.values(); it.next(); return it.next().value as number; }
function byPattern(s: Iterable<number>): number { let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; const [head, second] = s; return (head as number) < 0 ? -1 : (second as number); }
function byLoop(s: Set<number>): number { let n = 0; for (const m of s) if (n++) return m; return -1; }
const way = [byHand, byPattern, byLoop][ROAD]!, s = new Set<number>(); for (let i = 0; i < 20000; i++) s.add(i);
let sum = 0, last = 0; while (s.size > 1) { last = way(s); s.delete(last); sum = (sum + last) % 1000003; } console.log("SAID " + ROAD + " " + sum + " " + last); export {};
