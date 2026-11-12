const log: (string | number)[] = [];
function ticks(name: string, count: number): Promise<void> { let chain: Promise<void> = Promise.resolve(); for (let i = 0; i < count; i++) chain = chain.then(() => { log.push(name + i); }); return chain; }
function later(turns: number, value: any, rejects?: boolean): Promise<any> { return new Promise((resolve, reject) => { let chain: Promise<void> = Promise.resolve(); for (let i = 0; i < turns; i++) chain = chain.then(() => {}); chain.then(() => (rejects ? reject(value) : resolve(value))); }); }
const outside = (text: string): any[] => JSON.parse(text);
async function drain(name: string, list: any[], change: (list: any, value: any) => void) { for await (const value of list) { log.push(name + value); change(list, value); } log.push(name + "end"); }
await drain("a", outside("[1,2,3]"), (list, value) => { if (value === 1) list.push(9); });
await drain("b", outside("[1,2,3,4]"), (list, value) => { if (value === 2) list.length = 2; });
await drain("c", outside("[1,2,3]"), (list, value) => { if (value === 1) list[1] = Promise.resolve("P"); });
await drain("d", outside("[1,2,3]"), (list, value) => { if (value === 1) delete list[1]; });
await drain("e", outside("[1,2,3]"), (list, value) => { if (value === 1) Object.setPrototypeOf(list, { __proto__: Array.prototype, 2: "no" }); if (value === 2) delete list[2]; });
await drain("f", outside("[1,2,3]"), (list, value) => { if (value === 1) list[Symbol.iterator] = function* () { yield "never"; }; });
await drain("g", outside("[1,2,3]"), (list, value) => { if (value === 1) list[Symbol.asyncIterator] = async function* () { yield "never"; }; });
console.log("SAID", log.join(" "), process.argv.length);
