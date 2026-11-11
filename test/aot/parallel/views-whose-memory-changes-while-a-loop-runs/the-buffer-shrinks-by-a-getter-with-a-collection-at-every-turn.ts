// The buffer shrinks while the loop runs, by a getter that the turn reads. A collection at every turn.
const buffer = new ArrayBuffer(8, { maxByteLength: 16 });
let turns = 0;
const holder = { get touch() { Bun.gc(true); if (++turns === 11) buffer.resize(3); return 0; } };
function sum(view: Uint8Array, held: { touch: number }) { let total = 0; for (let i = 0; i < view.length; i++) total += held.touch + (view[i] ?? 100); return total; }
const view = new Uint8Array(buffer);
for (let i = 0; i < 8; i++) view[i] = i + 1;
console.log(sum(view, holder), sum(view, holder), sum(view, holder), view.length);
