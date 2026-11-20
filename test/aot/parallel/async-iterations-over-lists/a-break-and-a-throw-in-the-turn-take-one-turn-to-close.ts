const log: (string | number)[] = [];
function ticks(name: string, count: number): Promise<void> { let chain: Promise<void> = Promise.resolve(); for (let i = 0; i < count; i++) chain = chain.then(() => { log.push(name + i); }); return chain; }
function later(turns: number, value: any, rejects?: boolean): Promise<any> { return new Promise((resolve, reject) => { let chain: Promise<void> = Promise.resolve(); for (let i = 0; i < turns; i++) chain = chain.then(() => {}); chain.then(() => (rejects ? reject(value) : resolve(value))); }); }
const outside = (text: string): any[] => JSON.parse(text);
async function some(list: any[], limit: number) { for await (const value of list) { log.push("v" + value); if (value >= limit) break; } log.push("left"); }
async function fails(list: any[]) { try { for await (const value of list) { log.push("w" + value); throw "thrown"; } } catch (thrown) { log.push(String(thrown)); } }
async function returns(list: any[]) { for await (const value of list) { log.push("r" + value); return value; } }
await Promise.all([some(outside("[1,2,3]"), 2), ticks("t", 10)]);
await Promise.all([fails(outside("[1,2,3]")), ticks("u", 8)]);
await Promise.all([returns(outside("[1,2,3]")).then(value => log.push("got" + value)), ticks("s", 8)]);
console.log("SAID", log.join(" "), process.argv.length);
