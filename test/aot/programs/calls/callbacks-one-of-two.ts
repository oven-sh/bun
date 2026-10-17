// What a function calls is one of two values: a parameter or its default, one of two parameters, a variable that changes in a loop.
interface Item { id: number; label: string; next: Item | undefined }
const items: Item[] = [];
for (let i = 0; i < 6; i++) items.push({ id: i, label: "item" + i, next: undefined });
for (let i = 0; i + 1 < items.length; i++) items[i].next = items[i + 1];
const first = items[0];
const lines: string[] = [];
function attempt(label: string, run: () => unknown): void {
    try {
        lines.push(label + ": " + String(run()));
    } catch (error) {
        lines.push(label + " throws " + (error as Error).constructor.name);
    }
}

function sameId(a: Item, b: Item): boolean { return a.id === b.id; }
function sameLabel(a: Item, b: Item): boolean { return a.label === b.label; }
function contains(item: Item | undefined, wanted: Item, equals: (a: Item, b: Item) => boolean = sameId): boolean {
    if (item === undefined) return false;
    return equals(item, wanted) || contains(item.next, wanted, equals);
}
const stranger: Item = { id: 3, label: "stranger", next: undefined };
const comparers: Array<((a: Item, b: Item) => boolean) | undefined> = [sameLabel, undefined, (a, b) => a.id + 1 === b.id];
attempt("the default", () => contains(first, stranger));
attempt("undefined for the default", () => contains(first, stranger, undefined));
attempt("a declared function", () => contains(first, stranger, sameLabel));
attempt("a literal", () => contains(first, stranger, (a, b) => a.id > b.id + 10));
attempt("a literal with a capture", () => { const offset = 2; return contains(first, stranger, (a, b) => a.id === b.id + offset); });
for (const comparer of comparers) attempt("a comparer nobody knows", () => contains(first, stranger, comparer));
attempt("null is no default", () => contains(first, stranger, null as unknown as (a: Item, b: Item) => boolean));

function weigh(item: Item | undefined, heavy: boolean, whenHeavy: (item: Item) => number, whenLight: (item: Item) => number): number {
    if (item === undefined) return 0;
    const chosen = heavy ? whenHeavy : whenLight;
    return chosen(item) + weigh(item.next, !heavy, whenHeavy, whenLight);
}
attempt("one of two parameters", () => weigh(first, true, item => item.id * 10, item => item.id));
attempt("one of two parameters, one declared", () => weigh(first, false, idOf, item => -item.id));
function idOf(item: Item): number { return item.id; }
function negated(item: Item): number { return -item.id; }

function alternate(item: Item | undefined, start: (item: Item) => number): number {
    let current = start;
    let total = 0;
    for (let at = item; at !== undefined; at = at.next) {
        total = total * 2 + current(at);
        current = current === start ? start : negated;
    }
    return total;
}
attempt("compared with itself in a loop", () => alternate(first, idOf));
function swapping(item: Item | undefined, start: (item: Item) => number): number {
    let current = start;
    let total = 0;
    let turn = 0;
    for (let at = item; at !== undefined; at = at.next) {
        total = total * 2 + current(at);
        current = turn++ % 2 ? start : negated;
    }
    return total;
}
attempt("a variable that changes in a loop", () => swapping(first, idOf));
attempt("a variable that changes in a loop, from a literal", () => swapping(first, item => item.id + 100));
function growing(item: Item | undefined): number {
    let current: (item: Item) => number = idOf;
    let total = 0;
    let round = 0;
    for (let at = item; at !== undefined; at = at.next) {
        const before = current;
        const add = ++round;
        current = other => other.id + add;
        total = total * 3 + before(at) + current(at);
    }
    return total;
}
attempt("closures made in the loop, the one before still called", () => growing(first));
function orNothing(item: Item | undefined, visit: ((item: Item) => string) | undefined, fallback: (item: Item) => string = item => "<" + item.id + ">"): string {
    if (item === undefined) return "";
    return (visit ?? fallback)(item) + orNothing(item.next, visit, fallback);
}
attempt("?? between a parameter and a default that is a literal", () => orNothing(first, undefined));
attempt("?? with the first given", () => orNothing(first, item => item.label));
attempt("?? with both given", () => orNothing(first, undefined, item => "[" + item.id + "]"));
function last(item: Item, pick: (item: Item) => string = item => item.label): string {
    if (item.next === undefined) return pick(item);
    return last(item.next, pick);
}
attempt("the default in tail position", () => last(first));
attempt("given in tail position", () => last(first, item => item.label + "!"));
console.log(lines.join("\n"));
