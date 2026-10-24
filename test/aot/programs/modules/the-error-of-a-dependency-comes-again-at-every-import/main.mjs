// The error of a dependency comes again at every import.
const r = [];
for (let i = 0; i < 2; i++) r.push(await import("./top.mjs").then(() => "ok", e => e.message + ":" + (globalThis.last === (globalThis.last = e))));
r.push(await import("./throws.mjs").then(() => "ok", e => e.message + ":" + (globalThis.last === e)));
r.push(await import("./sibling.mjs").then(m => m.v, e => e.message));
console.log(r.join(), globalThis.runs);
