// What is written lies: the field holds undefined, null, another kind of value, or is taken out. Each read answers as plain Bun does.
const brought: any = (globalThis as any).brought;
class Other { tag: string; constructor(tag: string) { this.tag = tag; } }
class Thing { other: Other; count: number; constructor(i: number, other: any) { this.other = other; this.count = i; } }
function tagOf(t: Thing) { try { return t.other.tag; } catch (e) { return (e as Error).constructor.name; } }
function has(t: Thing) { return t.other ? 1 : 0; }
function same(t: Thing) { return t.other === undefined ? "u" : t.other === null ? "n" : typeof t.other; }
const things: Thing[] = [];
for (let i = 0; i < 400; i++) things.push(new Thing(i, i % 7 === 3 ? undefined : i % 7 === 5 ? null : i % 11 === 9 ? brought ?? 12 : i % 13 === 4 ? "text" : new Other("t" + i)));
delete (things[20] as any).other; Object.defineProperty(things[21], "other", { get() { return new Other("got"); }, configurable: true });
let out = ""; let n = 0;
for (let round = 0; round < 50; round++) for (const t of things) { n += has(t); if (round === 49) out += tagOf(t) + same(t) + ","; }
console.log(n, out.length, out.slice(0, 400));
things[0].other = undefined as any; things[1].other = null as any; console.log(tagOf(things[0]), tagOf(things[1]), same(things[0]), same(things[1]), has(things[0]));
