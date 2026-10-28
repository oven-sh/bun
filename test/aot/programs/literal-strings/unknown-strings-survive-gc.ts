// Strings that none of the program's literals equals, stored through `any` into fields written as a union of string literals and held only there, or held only by variables and closures, while the collector runs.
type Tag = "open" | "closed" | "";
class Holder {
    next: Tag | undefined = undefined;
    constructor(public tag: Tag, public id: number) {}
}
interface Pair { first: Tag; second: Tag | null }
function fresh(i: number): string {
    return "tag number " + i + " of " + (i * 7919) % 1000;
}
function churn(n: number): number {
    let t = 0;
    for (let i = 0; i < n; i++) t += [i, i + 1, i + 2].map(x => "garbage " + x).join().length;
    return t;
}
const old: Holder[] = [];
const untyped: any[] = old;
for (let i = 0; i < 2000; i++) {
    old.push(new Holder(i % 3 === 0 ? "open" : "", i));
    if (i % 3 === 1) untyped[i].tag = fresh(i);
}
let waste = churn(60000);
for (let round = 0; round < 20; round++) {
    for (let i = round; i < old.length; i += 20) {
        untyped[i].next = untyped[i].tag;
        untyped[i].tag = fresh(i + round * 10000);
    }
    waste += churn(20000);
}
let wrong = 0, open = 0, empty = 0, length = 0;
for (let i = 0; i < old.length; i++) {
    const h = untyped[i], round = i % 20;
    if (h.tag !== fresh(i + round * 10000)) wrong++;
    const before = i % 3 === 0 ? "open" : i % 3 === 1 ? fresh(i) : "";
    if (h.next !== before) wrong++;
    if (h.next === "open") open++;
    if (h.next === "") empty++;
    length += h.tag.length + h.next.length;
}
console.log(wrong, open, empty, length, waste > 0);
const pairs: Pair[] = [];
const untypedPairs: any[] = pairs;
const closures: (() => string)[] = [];
for (let i = 0; i < 3000; i++) {
    const held = fresh(i), other = i & 1 ? "closed" : fresh(-i);
    pairs.push({ first: "open", second: null });
    untypedPairs[i].first = held;
    if (i % 5) untypedPairs[i].second = other;
    closures.push(() => held + "/" + other);
    if (i % 500 === 0) waste += churn(20000);
}
waste += churn(60000);
let bad = 0;
for (let i = 0; i < 3000; i++) {
    const other = i & 1 ? "closed" : fresh(-i);
    if (untypedPairs[i].first !== fresh(i) || untypedPairs[i].second !== (i % 5 ? other : null) || closures[i]() !== fresh(i) + "/" + other) bad++;
}
console.log(bad, untypedPairs[7].first, untypedPairs[8].second, closures[9](), JSON.stringify(pairs[10]));
function* steps(tag: string, n: number) { for (let i = 0; i < n; i++) { waste += churn(3000); yield tag + i; } }
async function later(tag: string) { await null; waste += churn(30000); await null; return tag === "open" ? "open!" : tag; }
console.log([...steps(fresh(1), 4)].join(), [...steps("closed", 2)].join());
Promise.all([later(fresh(2)), later("open"), later("")]).then(all => console.log(all.join("|")));
