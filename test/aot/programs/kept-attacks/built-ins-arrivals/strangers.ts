// strangers.ts <form> <rounds>: objects that satisfy a structural type and were made under another name, handed to typed functions, stored in typed fields, variables and arrays.
type Item = { id: string; weight: number; tags?: string[] };
class Thing { id: string; weight: number; extra: number; constructor(id: string, weight: number) { this.id = id; this.weight = weight; this.extra = 7; } }
function weightOf(item: Item): number { return item.weight; }
function label(item: Item): string { return item.tags ? item.id + item.tags.length : item.id; }
class Holder { item: Item; constructor(item: Item) { this.item = item; } total(): number { return this.item.weight + this.item.id.length; } }
let current: Item = { id: "start", weight: 1 };
function setCurrent(item: Item): void { current = item; }
function currentWeight(): number { return current.weight; }
function pick(items: Item[], index: number): Item { return items[index % items.length]; }

const declared: Item = { id: "declared", weight: 2 };
const inferred = { id: "inferred", weight: 3, more: true };
const withTags = { id: "tags", weight: 4, tags: ["a", "b"] };
const base = { color: "red", weight: 5 };
const spread = { ...base, id: "spread" };
const thing = new Thing("thing", 6);

const [form, roundsText] = process.argv.slice(2);
const rounds = Number(roundsText) | 0;
let sum = 0;
let text = 0;
if (form === "parameters") {
    for (let r = 0; r < rounds; r++) { sum += weightOf(declared) + weightOf(inferred) + weightOf(withTags) + weightOf(spread) + weightOf(thing); text += label(inferred).length + label(withTags).length; }
} else if (form === "strangersOnly") {
    for (let r = 0; r < rounds; r++) sum += weightOf(inferred) + weightOf(inferred);
} else if (form === "fields") {
    const holders = [new Holder(declared), new Holder(inferred), new Holder(spread), new Holder(thing)];
    for (let r = 0; r < rounds; r++) sum += holders[r & 3].total();
} else if (form === "variables") {
    for (let r = 0; r < rounds; r++) { setCurrent(r & 1 ? inferred : thing); sum += currentWeight(); }
} else if (form === "elements") {
    const items: Item[] = [declared, inferred, withTags, spread, thing];
    for (let r = 0; r < rounds; r++) sum += pick(items, r).weight;
} else if (form === "parsed") {
    const parsed: Item = JSON.parse('{"id":"parsed","weight":8}');
    for (let r = 0; r < rounds; r++) sum += weightOf(parsed) + weightOf(inferred);
}
console.log(form, sum, text);
