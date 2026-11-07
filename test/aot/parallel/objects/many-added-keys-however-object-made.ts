// An object with more added keys than one entry of a key order counts keeps its fields, its key order and its class, however it was made: parsed and cast, parsed into an annotated variable, assigned to, spread, stored key by key, cloned.
type Row = { first: number; late?: number };
const members: string[] = [];
for (let i = 0; i < 70000; i++) members.push('"k' + i + '":' + i);
const text = '{"first":0,' + members.join(",") + ',"late":1}';
function tell(label: string, row: Row) {
  const keys = Object.keys(row);
  console.log(label, keys.length, keys[0], keys[1], keys[keys.length - 2], keys[keys.length - 1], row.first, row.late);
}
tell("cast", globalThis.JSON.parse(text) as Row);
const annotated: Row = JSON.parse(text);
tell("annotated", annotated);
class Bag { first = 0; late?: number; mark(value: number) { this.late = value } }
const assigned = Object.assign(new Bag(), globalThis.JSON.parse(text)) as Bag;
tell("assigned", assigned);
assigned.mark(5);
tell("marked", assigned);
const copy = { ...assigned } as Row;
tell("spread", copy);
const bag = new Bag();
delete bag.late;
for (let i = 0; i < 70000; i++) (bag as any)["k" + i] = i;
bag.mark(2);
tell("bag", bag);
tell("clone", structuredClone(bag));
console.log(JSON.stringify(bag).length, bag instanceof Bag, Object.entries(bag).length);
