class Item {
    kind: number;
    weight: number = 0.5;
    constructor(kind: number) {
        this.kind = kind;
    }
}
let calls = 0;
function note(item: Item): boolean {
    calls++;
    return item.weight > 0;
}
function isSpecial(item: Item): boolean {
    if (item.kind !== 7)
        return false;
    return note(item);
}
function count(items: Item[]): number {
    let special = 0;
    for (let i = 0; i < items.length; i++) {
        if (isSpecial(items[i]))
            special++;
    }
    return special;
}
function namesIn(stack: string | undefined): string {
    return (stack ?? "").split("\n").map(line => /at (\w+)/.exec(line)?.[1]).filter(name => name === "isSpecial" || name === "count" || name === "attempt").join(" < ");
}
function attempt(label: string, items: Item[]): void {
    try {
        console.log(label, count(items));
    } catch (error) {
        const thrown = error as Error;
        console.log(label, thrown.constructor.name, thrown.message.replace(/ \(evaluating .*\)$/, ""), "|", namesIn(thrown.stack));
    }
}
const items: Item[] = [];
for (let i = 0; i < 64; i++)
    items.push(new Item(i % 9));
for (let round = 0; round < 5000; round++)
    count(items);
attempt("whole", items);
items[40] = undefined as unknown as Item;
attempt("undefined", items);
items[40] = null as unknown as Item;
attempt("null", items);
items[40] = 7 as unknown as Item;
attempt("a number", items);
items[40] = "seven" as unknown as Item;
attempt("a string", items);
items[40] = { kind: 7, weight: 1 } as Item;
attempt("a literal", items);
items[40] = Object.create(null) as Item;
attempt("nothing at all", items);
items[40] = {
    get kind(): number {
        throw new RangeError("from the getter");
    },
    weight: 1,
} as Item;
attempt("a getter that throws", items);
console.log(calls);
