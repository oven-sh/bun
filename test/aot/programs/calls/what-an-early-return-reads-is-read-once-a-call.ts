class Item {
    kind: number;
    weight: number = 0.5;
    owner: Item | undefined = undefined;
    constructor(kind: number) {
        this.kind = kind;
    }
}
const seen: number[] = [];
const words: string[] = [];
function note(item: Item, word: string): boolean {
    seen.push(item.kind);
    if (words.length < 8)
        words.push(word + ":" + String(item.weight) + ":" + (item.owner === undefined ? "none" : typeof item.owner.weight));
    for (let owner = item.owner, depth = 0; owner !== undefined && depth < 3; owner = owner.owner, depth++) {
        if (owner.weight > 1)
            seen.push(-depth);
    }
    return true;
}
function isSpecial(item: Item): boolean {
    if (item.kind !== 7)
        return false;
    if (words.length > 100)
        words.length = 0;
    const first = note(item, "first");
    const second = seen.length % 1000003 === 1000002 ? note(item, "again") : first;
    return first && second;
}
function ownerIsSpecial(item: Item): boolean {
    const owner = item.owner;
    if (owner === undefined)
        return false;
    if (owner.kind !== 7)
        return false;
    if (words.length > 100)
        words.length = 0;
    const first = note(owner, "owner");
    const second = seen.length % 1000003 === 1000002 ? note(owner, "again") : first;
    return first && second;
}
function count(items: Item[], rounds: number): number {
    let special = 0;
    for (let round = 0; round < rounds; round++) {
        for (let i = 0; i < items.length; i++) {
            if (isSpecial(items[i]))
                special++;
            if (ownerIsSpecial(items[i]))
                special += 10;
        }
    }
    return special;
}
function report(label: string, items: Item[], rounds: number): void {
    seen.length = 0;
    const special = count(items, rounds);
    console.log(label, special, seen.length, seen.slice(0, 6).join(","), words.join(" "));
    words.length = 0;
}
const items: Item[] = [];
for (let i = 0; i < 16; i++) {
    items.push(new Item(i % 9));
    if (i)
        items[i].owner = items[i - 1];
}
report("plain", items, 20000);

let reads = 0;
Object.defineProperty(items[3], "kind", {
    get() {
        reads++;
        return reads % 2 ? 7 : 1;
    },
    configurable: true,
    enumerable: true,
});
report("a getter whose answers take turns", items, 5);
console.log("reads", reads);

let traps = 0;
const behindProxy = new Proxy(new Item(7), {
    get(target, key, receiver) {
        traps++;
        return Reflect.get(target, key, receiver);
    },
});
items[5] = behindProxy as Item;
report("a proxy", items, 5);
console.log("traps", traps);

let inherited = 0;
Object.defineProperty(Item.prototype, "kind", {
    get() {
        inherited++;
        return 7;
    },
    configurable: true,
});
delete (items[8] as { kind?: number }).kind;
report("deleted, and a getter on the prototype", items, 5);
console.log("inherited", inherited);

items[9].kind = 7.5;
items[10].kind = -0;
items[11].kind = NaN;
(items[12] as { kind: unknown }).kind = "7";
(items[13] as { kind: unknown }).kind = undefined;
report("what is no int32", items, 5);
items[9].kind = 7;
report("and back", items, 5);
