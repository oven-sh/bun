// plain: 1 true 8 9 12 4 4
let calls = 0; function measure(n: number): number { calls++; return n * 2; }
interface Handle { f0(): number; f1(): number; f2(): number; f3(): number; f4(): number; f5(): number; f6(): number; f7(): number; f8(): number; f9(): number; step: number; close(): number }
function open(start: number, count: number): Handle[] { let at = start; function close(): number { return ++at; } const out: Handle[] = []; for (let i = 0; i < count; i++) out.push({ f0: () => at + 0, f1: () => at + 1, f2: () => at + 2, f3: () => at + 3, f4: () => at + 4, f5: () => at + 5, f6: () => at + 6, f7: () => at + 7, f8: () => at + 8, f9: () => at + 9, step: measure(i), close }); return out; }
open(1, 1);
const all = open(+(process.argv[2] ?? 7), 3);
console.log("SAID", new Set(all.map(h => h.close)).size, all[0].close === all[2].close, all[0].close(), all[2].close(), all[1].f3(), all[2].step, calls);
export {};
