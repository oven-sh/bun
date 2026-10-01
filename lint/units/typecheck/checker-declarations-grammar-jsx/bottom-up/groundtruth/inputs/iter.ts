declare const n: number, s: string, u: string | number[], p: Promise<number>;
for (const a of n) {}
for (const b of s) {}
const [c] = u;
const d = [...n];
async function f() { for await (const e of n) {} const g = await p; const h = await 1; return g + h; }
function* gen(): number { yield 1; }
async function th(x: { then(): void }) { await x; }
declare const it: { [Symbol.iterator](): { next(): { done: boolean } } };
for (const q of it) {}
