// indexOf() and includes() of an object in a long array, the array and the object known by their types and handed in untyped.
// The search ran one element a turn through the library's loop, 17 instructions an element, where plain Bun compares several elements at a time: 5.5 times its cycles.
type Item = { i: number };
const items: Item[] = Array.from({ length: 20_000 }, (_, i) => ({ i }));
const last = items[items.length - 1];
const few = items.slice(0, 6);

function positionOf(list: Item[], item: Item): number { return list.indexOf(item); }
function holds(list: Item[], item: Item): boolean { return list.includes(item); }
function positionOfAnything(list: any, item: any): number { return list.indexOf(item); }
function holdsAnything(list: any, item: any): boolean { return list.includes(item); }

let total = 0;
for (let round = 0; round < 300; round++) {
  total += positionOf(items, last);
  if (holds(items, last)) total++;
  total += positionOfAnything(items, last);
  if (holdsAnything(items, last)) total++;
}
for (let round = 0; round < 100_000; round++) {
  total += positionOf(few, few[round % 6]);
  if (holds(few, last)) total++;
}
console.log(total);
