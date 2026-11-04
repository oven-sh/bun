// The buffer shrinks while the loop runs, by the callback. A collection at every turn.
function sum(view: Uint8Array, between: (i: number) => void) { let total = 0; for (let i = 0; i < view.length; i++) { between(i); total += view[i] ?? 100; } return total; }
function fill(view: Uint8Array, between: (i: number) => void) { for (let i = 0; i < view.length; i++) { between(i); view[i] = i + 1; } return view.length; }
const buffer = new ArrayBuffer(8, { maxByteLength: 16 });
const view = new Uint8Array(buffer);
const seen: unknown[] = [];
seen.push(fill(view, () => { Bun.gc(true); }), sum(view, () => { Bun.gc(true); }));
seen.push(sum(view, i => { Bun.gc(true); if (i === 2) buffer.resize(4); }), sum(view, () => { Bun.gc(true); }));
seen.push(fill(view, i => { Bun.gc(true); if (i === 1) buffer.resize(12); }), sum(view, () => { Bun.gc(true); }));
seen.push(fill(view, i => { Bun.gc(true); if (i === 3) buffer.resize(1); }), sum(view, () => { Bun.gc(true); }));
console.log(seen.join());
