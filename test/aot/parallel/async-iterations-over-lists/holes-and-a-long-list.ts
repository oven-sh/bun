const log: (string | number)[] = [];
function ticks(name: string, count: number): Promise<void> { let chain: Promise<void> = Promise.resolve(); for (let i = 0; i < count; i++) chain = chain.then(() => { log.push(name + i); }); return chain; }
function later(turns: number, value: any, rejects?: boolean): Promise<any> { return new Promise((resolve, reject) => { let chain: Promise<void> = Promise.resolve(); for (let i = 0; i < turns; i++) chain = chain.then(() => {}); chain.then(() => (rejects ? reject(value) : resolve(value))); }); }
const outside = (text: string): any[] => JSON.parse(text);
async function sum(list: any[]) { let total: any = 0, holes = 0; for await (const value of list) { if (value === undefined) holes++; else total += value; } return total + ":" + holes; }
const long = outside("[" + Array.from({ length: 300 }, (_, i) => i) + "]");
log.push(await sum(long), await sum([1, , 3, , 5]), await sum([1.5, 2.5]), await sum(["a"].concat([])));
async function* all(list: any[]): AsyncGenerator<any> { yield* list; yield* list; }
let seen = 0; for await (const value of all(long)) seen += value; log.push(seen);
console.log("SAID", log.join(" "), process.argv.length);
