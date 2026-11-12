// The buffer is handed away while the loop runs, by the callback, and what it was is collected. A collection at every turn.
function sum(view: Uint8Array, between: (i: number) => void) { let total = 0; for (let i = 0; i < view.length; i++) { between(i); total += view[i] ?? 100; } return total; }
function fill(view: Uint8Array, between: (i: number) => void) { for (let i = 0; i < view.length; i++) { between(i); view[i] = i + 1; } return view.length; }
function fresh() { const view = new Uint8Array(64); for (let i = 0; i < 64; i++) view[i] = 1; return view; }
const seen: unknown[] = [];
const first = fresh();
seen.push(sum(first, () => { Bun.gc(true); }));
seen.push(sum(first, i => { if (i === 2) first.buffer.transfer(); Bun.gc(true); new Uint8Array(64).fill(7); }), first.length);
const second = fresh();
seen.push(fill(second, i => { if (i === 5) structuredClone(second.buffer, { transfer: [second.buffer] }); Bun.gc(true); new Uint8Array(64).fill(7); }), second.length);
console.log(seen.join());
