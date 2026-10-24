type Kind = "leaf" | "node" | "root";
interface Item { kind: Kind; weight: number; label?: Kind }
function make(kind: Kind, weight: number): Item {
    return { kind, weight };
}
function score(item: Item): number {
    if (item.kind === "leaf") return 1;
    if (item.kind !== "node") return 2;
    return item.weight;
}
function name(kind: Kind): string {
    switch (kind) {
        case "leaf": return "a leaf";
        case "node": return "a node";
        default: return "the " + kind;
    }
}
function same(a: Kind, b: Kind): boolean { return a === b; }
function relabel(item: Item, to: Item): void { item.label = to.kind; item.kind = "root"; }
const items: Item[] = [make("leaf", 1), make("node", 5), make("root", 9)];
let total = 0;
for (const item of items) total += score(item);
relabel(items[0], items[1]);
console.log(total, name("leaf"), name("root"), same(items[0].kind, items[1].kind), items[2].kind, JSON.stringify(items[0]), items[0].label ? "yes" : "no", items[1].label ?? "none");
