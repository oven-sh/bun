const order = []; let digest = 0; const saw = x => { digest = (Math.imul(digest, 31) + x) | 0; };
const hooks = require("node:async_hooks"); let inits = 0;
const hook = hooks.createHook({ init(id, type) { if (type === "TickObject") inits++; } });
const count = 15_000;
function tick(i) { saw(i); if (i === 5_000) hook.enable(); if (i === 9_000) hook.disable(); if (i > 5_000 && i < 9_500 && i % 7 === 0) process.nextTick(saw, -i); }
for (let i = 0; i < count; i++) process.nextTick(tick, i);
setImmediate(() => console.log(digest, inits));
