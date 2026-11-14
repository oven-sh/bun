// A Map of lists of records, declared, filled in two loops
type Item = { id: number; tags: string[]; score?: number };
function byTag(items: Item[]): string {
  const map = new Map<string, Item[]>();
  for (const item of items) {
    for (const tag of item.tags) {
      const list = map.get(tag);
      if (list) list.push(item);
      else map.set(tag, [item]);
      item.score = (item.score ?? 0) + (list?.length ?? 0.5);
    }
  }
  return [...map].map(([tag, list]) => tag + ":" + list.map(item => item.id + "/" + item.score).join("+")).join(" ");
}
console.log(byTag([{ id: 1, tags: ["a", "b"] }, { id: 2, tags: ["a"] }]));
console.log(byTag([{ id: 0.5, tags: ["x", "x", "y"], score: 3 }]));
console.log(byTag([]) + "|", byTag([{ id: 1, tags: [] }, { id: -1, tags: ["constructor"] }]));
