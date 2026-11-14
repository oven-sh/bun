// How many turns of the job queue pass until a file that imports "bun", or exports names of it again, begins behind an import(), and until the import() is there.
// `bun <file>` transpiles each file on another thread, and the queue turns while that thread works: it prints this program's own cap, 300, and then 0. Held to one thread it prints what the executable prints, which stands here.
globalThis.ticks = 0;
let running = true;
(function tick() { if (!running || globalThis.ticks > 300) return; globalThis.ticks++; Promise.resolve().then(tick); })();
const done = () => { running = false; };
const race = async (name, start) => { const from = globalThis.ticks; globalThis.from = from; await start(); console.log(name, "imported after", globalThis.ticks - from); };
await race("./b.mjs", () => import("./b.mjs")); await race("./c.mjs", () => import("./c.mjs")); await race("./d.mjs", () => import("./d.mjs")); await race("./e.mjs", () => import("./e.mjs")); await race("./f.mjs", () => import("./f.mjs")); done();

/* Output:
b begins after 6 function
./b.mjs imported after 13
c begins after 6 function
./c.mjs imported after 13
d begins after 6
./d.mjs imported after 13
e begins after 11
./e.mjs imported after 18
f begins after 6
./f.mjs imported after 13
*/
