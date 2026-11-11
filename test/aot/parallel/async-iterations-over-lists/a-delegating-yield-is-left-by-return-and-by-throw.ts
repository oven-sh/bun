const log: (string | number)[] = [];
function ticks(name: string, count: number): Promise<void> { let chain: Promise<void> = Promise.resolve(); for (let i = 0; i < count; i++) chain = chain.then(() => { log.push(name + i); }); return chain; }
function later(turns: number, value: any, rejects?: boolean): Promise<any> { return new Promise((resolve, reject) => { let chain: Promise<void> = Promise.resolve(); for (let i = 0; i < turns; i++) chain = chain.then(() => {}); chain.then(() => (rejects ? reject(value) : resolve(value))); }); }
const outside = (text: string): any[] => JSON.parse(text);
async function* rows(list: any[]): AsyncGenerator<any, void, any> { try { yield* list; log.push("through"); } catch (thrown) { log.push("inside:" + (thrown instanceof TypeError ? "TypeError" : thrown)); yield "after"; } finally { log.push("finally"); } }
async function byReturn() { const steps = rows(outside("[1,2,3]")); log.push("n" + (await steps.next()).value); const left = await steps.return("out" as any); log.push("r" + left.value + left.done); log.push("n" + (await steps.next()).done); }
async function byThrow() { const steps = rows(outside("[1,2,3]")); log.push("m" + (await steps.next()).value); const left = await steps.throw("boom"); log.push("x" + left.value + left.done); log.push("m" + (await steps.next()).done); }
async function returnsPromise() { const steps = rows(outside("[1,2,3]")); await steps.next(); const left = await steps.return(later(2, "late")); log.push("p" + left.value + left.done); }
await Promise.all([byReturn(), ticks("t", 14)]);
await Promise.all([byThrow(), ticks("u", 16)]);
await Promise.all([returnsPromise(), ticks("s", 14)]);
console.log("SAID", log.join(" "), process.argv.length);
