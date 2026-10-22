// Adjacent stores to old objects where one field alone can hold a cell: a union of string literals next to a number and a boolean. The string is a literal of the program, or one that is stored through `any` and that only the field keeps alive while the collector runs.
type Tag = "open" | "closed" | "";
class Entry {
    constructor(public tag: Tag, public count: number, public isActive: boolean) {}
}
function fresh(i: number): string {
    return "tag number " + i + " of " + (i * 7919) % 1000;
}
function churn(n: number): number {
    let total = 0;
    for (let i = 0; i < n; i++) total += [i, i + 1, i + 2].map(x => "garbage " + x).join().length;
    return total;
}
function setUnknown(entry: Entry, i: number): void {
    const tag = fresh(i);
    (entry as any).tag = tag;
    entry.count = i;
    entry.isActive = (i & 1) === 0;
}
function setLiteral(entry: Entry, i: number): void {
    entry.tag = "closed";
    entry.count = i;
    entry.isActive = false;
}
function setEither(entry: Entry, tag: string, i: number): void {
    entry.count = i;
    (entry as any).tag = tag;
}

const entries: Entry[] = [];
const lastKind: number[] = [];
const lastIndex: number[] = [];
for (let i = 0; i < 2000; i++) {
    entries.push(new Entry("open", i, true));
    lastKind.push(-1);
    lastIndex.push(i);
}
let waste = churn(60000);
for (let round = 0; round < 24; round++) {
    for (let k = round % 8; k < entries.length; k += 8) {
        const i = k + round * 10000;
        const kind = (k + round) % 4;
        if (kind === 0) setUnknown(entries[k], i);
        else if (kind === 1) setLiteral(entries[k], i);
        else setEither(entries[k], kind === 2 ? fresh(i) : "open", i);
        lastKind[k] = kind;
        lastIndex[k] = i;
    }
    waste += churn(20000);
}

let wrong = 0, unknown = 0, length = 0;
for (let k = 0; k < entries.length; k++) {
    const entry = entries[k], kind = lastKind[k], i = lastIndex[k];
    const tag = kind === 0 || kind === 2 ? fresh(i) : kind === 1 ? "closed" : "open";
    const held: string = (entry as any).tag;
    if (held !== tag || entry.count !== i) wrong++;
    if (kind === 0 && entry.isActive !== ((i & 1) === 0)) wrong++;
    if (kind === 1 && entry.isActive) wrong++;
    if (kind === 0 || kind === 2) unknown++;
    length += held.length;
}
console.log(wrong, unknown, length, waste > 0);
