const next = Object.getPrototypeOf(Object.getPrototypeOf((async function* () {})())).next;
const odd: any = { [Symbol.asyncIterator]() { return { next }; } };
async function walk() { try { for await (const x of odd) console.log(x); } catch (e) { console.log((e as Error).constructor.name); } }
walk();
