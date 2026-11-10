const order = []; let digest = 0; const saw = x => { digest = (Math.imul(digest, 31) + x) | 0; };
const count = 20_000; let caught = 0;
process.on("uncaughtException", error => { caught++; saw(error.message.length); });
function tick(i) { saw(i); if (i % 4099 === 0) throw new Error("at " + i); }
for (let i = 0; i < count; i++) process.nextTick(tick, i);
setImmediate(() => setImmediate(() => console.log(digest, caught)));
