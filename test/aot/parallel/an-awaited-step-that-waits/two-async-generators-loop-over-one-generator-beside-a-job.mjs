// Both loops stand in async generators, and a job is queued between their requests.
const log = [], extra = () => { queueMicrotask(() => log.push("m")); }; let kick; async function* body() { await null; yield 1; kick(); } const held = body(), things = { [Symbol.asyncIterator]: () => held };
async function* b() { for await (const v of things) { log.push("b" + v); yield v; } log.push("b end"); } async function drain(g) { for await (const v of g) ; }
kick = () => { extra(); drain(b()); }; async function* a() { for await (const v of things) { log.push("a" + v); yield v; } log.push("a end"); }
await drain(a()); await new Promise(r => setTimeout(r, 5)); console.log(log.join());
