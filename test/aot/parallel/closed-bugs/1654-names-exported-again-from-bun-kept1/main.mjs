globalThis.ticks = 0;
let running = true;
(function tick() { if (!running || globalThis.ticks > 300) return; globalThis.ticks++; Promise.resolve().then(tick); })();
const done = () => { running = false; };
const race = async (name, start) => { const from = globalThis.ticks; globalThis.from = from; await start(); console.log(name, "imported after", globalThis.ticks - from); };
await race("./b.mjs", () => import("./b.mjs")); await race("./c.mjs", () => import("./c.mjs")); await race("./d.mjs", () => import("./d.mjs")); await race("./e.mjs", () => import("./e.mjs")); await race("./f.mjs", () => import("./f.mjs")); done();
