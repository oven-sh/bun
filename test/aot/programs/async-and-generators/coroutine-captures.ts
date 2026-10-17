// Variables captured by async functions and generators.
function* counter(from: number, step: number) { let at = from; const bump = () => { at += step; }; while (at < from + 3 * step) { yield at; bump(); } }
async function sum(list: number[], scale: number) { let total = 0; for (const x of list) { await null; [x].forEach(v => { total += v * scale; }); } return total; }
function makers(k: number) { return { gen: function* () { yield k; yield k + 1; }, run: async () => { await null; return k * 2; } }; }
const made = makers(5);
console.log([...counter(1, 2)].join(), [...made.gen()].join());
sum([1, 2, 3], 10).then(async total => { console.log(total, await made.run()); });
async function awaited() { const fs: (() => number)[] = []; for await (const x of (fs.push((): number => x), [1, 2])) { fs.push(() => x); } const out: string[] = []; for (const f of fs) { try { out.push(String(f())); } catch (e) { out.push((e as Error).name); } } return out.join(); }
awaited().then(r => console.log(r));
