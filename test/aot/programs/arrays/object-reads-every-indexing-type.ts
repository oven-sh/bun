declare const console: { log(...values: unknown[]): void };
class Rec { constructor(public n: number) {} }
interface Holder { items: Rec[]; maybe: (Rec | undefined)[]; }
let depth = 0;
function at(holder: Holder, place: number): number { if (depth > 0) { depth--; at(holder, place); } const rec = holder.items[place]; return rec ? rec.n : -1; }
function atMaybe(holder: Holder, place: number): number { if (depth > 0) { depth--; atMaybe(holder, place); } const rec = holder.maybe[place]; return rec === undefined ? -2 : rec.n; }
function sumOf(holder: Holder): number { let total = 0; for (const rec of holder.items) total += rec.n; return total; }
function sumByIndex(list: readonly Rec[]): number { let total = 0; for (let i = 0; i < list.length; i++) total += list[i].n; return total; }
function describe(action: () => unknown): string { try { return String(action()); } catch (error) { return "throws " + (error instanceof TypeError ? "TypeError" : String(error)); } }
const recs = [new Rec(1), new Rec(2), new Rec(3)];
const holders: Holder[] = [
    { items: recs, maybe: [undefined, new Rec(5), undefined] },
    { items: [], maybe: [] },
    { items: recs.slice(), maybe: [undefined, undefined] },
    { items: Object.freeze(recs.slice()) as Rec[], maybe: Object.seal([new Rec(7), undefined]) as (Rec | undefined)[] },
    { items: new Array<Rec>(3), maybe: new Array<Rec | undefined>(2) },
    { items: Array.from({ length: 2 }, (_, i) => new Rec(i + 10)), maybe: [, new Rec(9)] as (Rec | undefined)[] },
];
const sparse: Rec[] = []; sparse[5000] = new Rec(50); holders.push({ items: sparse, maybe: sparse });
class Recs extends Array<Rec> {}
const derived = new Recs(); derived.push(new Rec(21), new Rec(22)); holders.push({ items: derived, maybe: derived });
const grown: Rec[] = []; for (let i = 0; i < 40; i++) grown.push(new Rec(i)); grown.length = 4; holders.push({ items: grown, maybe: grown });
for (let round = 0; round < 2; round++) {
    for (const holder of holders) {
        const row: string[] = [];
        for (const place of [0, 1, 2, 3, -1, 0.5, NaN, 5000, 4294967295, 4294967296]) row.push(describe(() => at(holder, place)) + "/" + describe(() => atMaybe(holder, place)));
        row.push(describe(() => sumOf(holder)), describe(() => sumByIndex(holder.items)));
        console.log(row.join(" "));
    }
}
const literal: (Rec | undefined | null)[] = [undefined, null, undefined];
function countNothing(list: (Rec | undefined | null)[]): number { let count = 0; for (let i = 0; i < list.length; i++) if (!list[i]) count++; return count; }
console.log(countNothing(literal), countNothing(literal)); literal[1] = new Rec(1); console.log(countNothing(literal));
