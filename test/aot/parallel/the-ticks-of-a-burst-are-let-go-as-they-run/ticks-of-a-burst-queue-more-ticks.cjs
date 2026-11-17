const order = []; let digest = 0; const saw = x => { digest = (Math.imul(digest, 31) + x) | 0; };
const count = 30_000; let more = 0;
function tick(i) { saw(i); if (i % 3 === 0 && more < 60_000) { more++; process.nextTick(tick, i + 1_000_001); } }
for (let i = 0; i < count; i++) process.nextTick(tick, i);
setImmediate(() => console.log(digest, more));
