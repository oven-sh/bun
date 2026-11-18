const log: (string | number)[] = [];
function ticks(name: string, count: number): Promise<void> { let chain: Promise<void> = Promise.resolve(); for (let i = 0; i < count; i++) chain = chain.then(() => { log.push(name + i); }); return chain; }
function later(turns: number, value: any, rejects?: boolean): Promise<any> { return new Promise((resolve, reject) => { let chain: Promise<void> = Promise.resolve(); for (let i = 0; i < turns; i++) chain = chain.then(() => {}); chain.then(() => (rejects ? reject(value) : resolve(value))); }); }
const outside = (text: string): any[] => JSON.parse(text);
async function drain(list: any[]) { try { for await (const value of list) log.push("v" + value); log.push("end"); } catch (thrown) { log.push("caught" + thrown); } finally { log.push("finally"); } }
await Promise.all([drain([1, Promise.reject("X"), 3]), ticks("t", 12)]);
await Promise.all([drain([later(2, "Y", true), 3]), ticks("u", 12)]);
console.log("SAID", log.join(" "), process.argv.length);
