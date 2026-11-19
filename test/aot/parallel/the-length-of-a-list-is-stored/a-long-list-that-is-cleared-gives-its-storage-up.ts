const { heapStats } = require("bun:jsc");
function held(): number { Bun.gc(true); Bun.gc(true); const stats = heapStats(); return stats.heapSize + stats.extraMemorySize; }
function clear(list: unknown[]): void { list.length = 0; }
function cut(list: unknown[], to: number): void { list.length = to >>> 0; }
const whole: number[] = [], fractions: number[] = [], texts: string[] = [];
for (let i = 0; i < 2000000; i++) { whole.push(i); fractions.push(i + 0.5); texts.push("t"); }
const full = held();
clear(whole); cut(fractions, 3); clear(texts);
const cleared = held();
console.log(whole.length, fractions.length, fractions[2], 3 in fractions, texts.length, "given up:", full - cleared > 40000000);
for (let i = 0; i < 100; i++) { whole.push(i); fractions.push(i + 0.5); texts.push("u"); }
console.log(whole.length, whole[99], fractions.length, fractions[3], texts.length, texts[0]);
