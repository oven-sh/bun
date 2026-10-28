// A field written as a union of string literals promises a string. Parsed data that holds another string passes the cast, which asks only for an object, and typed code reads the field, and stores what it read, as it is.
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
const items: Item[] = [make("leaf", 1), make("node", 5), make("root", 9)];
let total = 0;
for (const item of items) total += score(item);
console.log(total, name("leaf"), name("root"), same(items[0].kind, items[1].kind), items[2].kind, JSON.stringify(items[1]));
const parsed: Item = JSON.parse('{"kind":"other","weight":3}') as Item;
try { console.log(score(parsed), parsed.kind, name(parsed.kind), typeof parsed.kind, parsed.kind.length, `${parsed.kind}!`); } catch (e) { console.log("read:", (e as Error).constructor.name); }
try { items[0].kind = parsed.kind; } catch (e) { console.log("stored:", (e as Error).constructor.name); }
try { console.log(items[0].kind, items[0].label, items[0].kind === parsed.kind); } catch (e) { console.log("compared:", (e as Error).constructor.name); }
console.log((parsed as any).kind, parsed.weight, items[0].kind);
