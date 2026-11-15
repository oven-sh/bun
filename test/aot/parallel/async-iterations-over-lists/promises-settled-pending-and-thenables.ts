const log: (string | number)[] = [];
function ticks(name: string, count: number): Promise<void> { let chain: Promise<void> = Promise.resolve(); for (let i = 0; i < count; i++) chain = chain.then(() => { log.push(name + i); }); return chain; }
function later(turns: number, value: any, rejects?: boolean): Promise<any> { return new Promise((resolve, reject) => { let chain: Promise<void> = Promise.resolve(); for (let i = 0; i < turns; i++) chain = chain.then(() => {}); chain.then(() => (rejects ? reject(value) : resolve(value))); }); }
const outside = (text: string): any[] => JSON.parse(text);
async function drain(list: any[]) { for await (const value of list) log.push("v" + value); log.push("end"); }
const thenable = { then(resolve: (value: string) => void) { log.push("then"); resolve("T"); } };
await Promise.all([drain([Promise.resolve("R"), later(3, "L"), thenable, 4, later(0, "Z")]), ticks("t", 26)]);
console.log("SAID", log.join(" "), process.argv.length);
