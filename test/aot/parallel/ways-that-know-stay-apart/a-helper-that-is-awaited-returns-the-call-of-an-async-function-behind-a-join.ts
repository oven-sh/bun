// `await helper(kind)`: the helper is copied in line and its one return hands back the call of an async function; the block of that call is a join that leans on what one way into it has read. Whichever way is taken, what is awaited is a number
const enum Bits { None = 0, One = 1, Two = 2, Four = 4, Eight = 8, ThirtyTwo = 32 }
class Kind { flags: Bits; objectFlags: Bits; symbol: string; next: Kind | undefined; constructor(flags: Bits, objectFlags: Bits, symbol: string) { this.flags = flags; this.objectFlags = objectFlags; this.symbol = symbol; this.next = undefined; } }
// No literal lists the names of the class: its fields keep their raw slots.
function odd(text: string, name?: string, value?: unknown): any { const made = JSON.parse(text); if (name) made[name] = value; return made; }
async function work(n: number): Promise<number> { await null; return n * 2; }
function helper(kind: Kind, c: boolean) { const f = c ? kind.objectFlags : 0; return work(f & Bits.ThirtyTwo); }
async function sum(kind: Kind, c: boolean) { const given = await helper(kind, c); return typeof given + ":" + given; }
// Nobody knows who calls it: it has a body of its own, and nothing is proven of what it is handed.
const table: any[] = [sum];
for (const entered of table) {
    const all: Promise<string>[] = [];
    for (let i = 0; i < 40; i++) all.push(entered(new Kind(0, i & 36, "k"), (i & 3) !== 0));
    all.push(entered(odd('{"objectFlags":"32"}'), true), entered(odd('{"objectFlags":"32"}'), false), entered(odd('{}'), true));
    Promise.all(all).then(texts => console.log(texts.join()));
}
