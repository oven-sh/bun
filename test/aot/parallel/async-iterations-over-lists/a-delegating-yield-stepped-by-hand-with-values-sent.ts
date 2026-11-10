const log: (string | number)[] = [];
function ticks(name: string, count: number): Promise<void> { let chain: Promise<void> = Promise.resolve(); for (let i = 0; i < count; i++) chain = chain.then(() => { log.push(name + i); }); return chain; }
function later(turns: number, value: any, rejects?: boolean): Promise<any> { return new Promise((resolve, reject) => { let chain: Promise<void> = Promise.resolve(); for (let i = 0; i < turns; i++) chain = chain.then(() => {}); chain.then(() => (rejects ? reject(value) : resolve(value))); }); }
const outside = (text: string): any[] => JSON.parse(text);
async function* rows(list: any[]): AsyncGenerator<any, string, any> { const answer = yield* list; log.push("answer" + answer); return "R"; }
const steps = rows(outside("[1,2]"));
const asked = [steps.next("a"), steps.next("b"), steps.next("c"), steps.next("d")].map((step, i) => step.then(result => { log.push(i + ":" + result.value + ":" + result.done); }));
await Promise.all([...asked, ticks("t", 16)]);
console.log("SAID", log.join(" "), process.argv.length);
