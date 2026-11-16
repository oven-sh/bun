const log: (string | number)[] = [];
function ticks(name: string, count: number): Promise<void> { let chain: Promise<void> = Promise.resolve(); for (let i = 0; i < count; i++) chain = chain.then(() => { log.push(name + i); }); return chain; }
function later(turns: number, value: any, rejects?: boolean): Promise<any> { return new Promise((resolve, reject) => { let chain: Promise<void> = Promise.resolve(); for (let i = 0; i < turns; i++) chain = chain.then(() => {}); chain.then(() => (rejects ? reject(value) : resolve(value))); }); }
const outside = (text: string): any[] => JSON.parse(text);
async function* rows(list: any[]): AsyncGenerator<any> { log.push("start"); const answer = yield* list; log.push("answer" + answer); }
async function drain(list: any[]) { for await (const value of rows(list)) log.push("v" + value); log.push("end"); }
await Promise.all([drain(outside("[1,2,3]")), ticks("t", 22)]);
await Promise.all([drain(outside("[]")), ticks("e", 8)]);
console.log("SAID", log.join(" "), process.argv.length);
