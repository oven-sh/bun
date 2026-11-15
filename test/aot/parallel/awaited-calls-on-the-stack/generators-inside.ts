const out: string[] = [];
const where = () => String(new Error("w").stack).split("\n").slice(2).map(line => line.trim().replace(/^at /, "").replace(/ ?\(.*\)$/, "").replace(/^\/.*$/, "module")).filter(name => name !== "next" && name !== "module" && !/native|unknown/.test(name)).join(" < ");
async function* numbers(n: number) { for (let i = 0; i < n; i++) { await i; out.push("gen " + where()); yield i; } }
async function* outerNumbers(n: number) { for await (const x of numbers(n)) { out.push("outer gen " + where()); yield x * 2; } }
function* plain(n: number) { for (let i = 0; i < n; i++) { out.push("plain " + where()); yield i; } }
async function consume(n: number) { await n; let sum = 0; for await (const x of outerNumbers(n)) { sum += x; await x; out.push("consume " + sum + " " + where()); } return sum; }
async function consumePlain(n: number) { await n; let sum = 0; for (const x of plain(n)) { sum += x; await x; } for await (const x of plain(n)) sum += x; for (const x of [...plain(2)]) sum += await leaf(x); return sum; }
async function leaf(n: number) { await n; out.push("leaf " + where()); return n; }
async function first(n: number) { for await (const x of numbers(n)) { if (x === 1) return await leaf(x); } return -1; }
async function both(n: number) { const a = await consume(n); const b = await consumePlain(n); const c = await first(n); out.push(`both ${a} ${b} ${c} ` + where()); return a + b + c; }
async function main() { await 0; for (let i = 0; i < 3; i++) out.push("main " + await both(i)); }
await main();
for (let i = 0; i < 3; i++) out.push("top " + await both(i));
async function* delegating() { yield* numbers(2); const x = await both(1); yield x; }
for await (const x of delegating()) out.push("delegated " + x);
console.log(out.join("\n"));
