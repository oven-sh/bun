const log: (string | number)[] = [];
function ticks(name: string, count: number): Promise<void> { let chain: Promise<void> = Promise.resolve(); for (let i = 0; i < count; i++) chain = chain.then(() => { log.push(name + i); }); return chain; }
function later(turns: number, value: any, rejects?: boolean): Promise<any> { return new Promise((resolve, reject) => { let chain: Promise<void> = Promise.resolve(); for (let i = 0; i < turns; i++) chain = chain.then(() => {}); chain.then(() => (rejects ? reject(value) : resolve(value))); }); }
const outside = (text: string): any[] => JSON.parse(text);
async function drainLists(name: string, list: any[]) { for await (const value of list) log.push(name + value); log.push(name + "end"); }
async function drainOthers(name: string, other: any) { for await (const value of other) log.push(name + value); log.push(name + "end"); }
async function* pass(list: any[]): AsyncGenerator<any> { yield* list; }
const own: any = outside("[1,2]"); own[Symbol.asyncIterator] = async function* () { yield "A"; };
const sync: any = outside("[1,2]"); sync[Symbol.iterator] = function* () { yield "S"; };
const Below: any = class extends (Array as any) { *[Symbol.iterator]() { yield "B"; } };
const BelowAsync: any = class extends (Array as any) { async *[Symbol.asyncIterator]() { yield "C"; } };
const named: any = outside("[1,2]"); named.extra = 1;
const above = outside("[1,2]"); Object.setPrototypeOf(above, { __proto__: Array.prototype, async *[Symbol.asyncIterator]() { yield "P"; } });
async function* made() { yield "G"; }
for (const [name, list] of [["i", outside("[1,2]")], ["a", own], ["b", sync], ["c", Below.of(1, 2)], ["k", BelowAsync.of(1, 2)], ["d", named], ["p", above], ["j", outside("[3]")]] as [string, any[]][]) { await Promise.all([drainLists(name, list), ticks(name + "t", 7)]); await Promise.all([drainOthers(name + "y", pass(list)), ticks(name + "u", 9)]); }
for (const [name, other] of [["e", new Set([5, 6])], ["f", "xy"], ["g", made()], ["h", new Uint8Array([3, 4])]] as [string, any][]) await Promise.all([drainOthers(name, other), ticks(name + "t", 7)]);
for (const wrong of [undefined, null, 5, {}] as any[]) { try { await drainLists("w", wrong); } catch (thrown) { log.push((thrown as Error).constructor.name); } }
console.log("SAID", log.join(" "), process.argv.length);
