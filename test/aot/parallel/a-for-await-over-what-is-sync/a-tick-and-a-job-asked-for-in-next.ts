const log: string[] = [];
const things: any = { i: 0, [Symbol.iterator]() { return this; }, next() { const i = this.i++; if (i === 1) { process.nextTick(() => { log.push("tick"); }); Promise.resolve().then(() => { log.push("job"); }); } return { done: i === 3, value: i }; } };
async function walk() { await null; for await (const x of things) log.push("x" + x); log.push("end"); }
setTimeout(() => { walk().then(() => console.log(log.join(" "))); }, 1);
