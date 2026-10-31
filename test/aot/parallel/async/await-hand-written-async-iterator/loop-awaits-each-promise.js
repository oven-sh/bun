async function collectAsync(it) { const list = []; for await (const v of it) { list.push(await v); } return list.length + ":" + list.map(x => typeof x + (x instanceof Promise)).join(); }
const o = [1];
o[Symbol.asyncIterator] = function () { let i = 0; return { next() { return i++ < 2 ? { done: false, value: Promise.resolve(7) } : 0; } }; };
function run(x) { try { return collectAsync(x).then(r => console.log("answered", r), e => console.log("rejected", e.name, e.message)); } catch (e) { console.log("threw", e.name); } }
process.on("unhandledRejection", e => console.log("unhandled", e.message));
await run(o);
