// Lists that are always empty, or hold nothing but holes, are handed to built-in walks whose callback reads a member of the element. The callback is never handed an object.
type Item = { on: boolean; name: string };

function pick(list: Item[]): Item[] {
  return list.filter(it => it.on);
}
function names(list: Item[]): string[] {
  return list.map(it => it.name);
}
function pickNamed(list: Item[], wanted: string): Item[] {
  return list.filter(it => it.on && it.name === wanted);
}

console.log(pick([]).length, pick([]).length, names([]).length);
const lists: Item[][] = [[], new Array(2)];
for (const list of lists) console.log(pickNamed(list, "a").length);
