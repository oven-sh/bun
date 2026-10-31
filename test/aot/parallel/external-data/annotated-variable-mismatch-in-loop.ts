// Matching and mismatching objects enter the same annotated variable in turn.
interface Item { id: number; tags: string[] }
function total(list: any[]): string {
  let sum = 0, untagged = 0;
  for (let i = 0; i < list.length; i++) {
    const item: Item = list[i];
    if (item.tags) { sum += item.tags.length; item.tags = []; } else { untagged++; item.tags = ["new"]; }
  }
  return sum + " " + untagged + " " + JSON.stringify(list);
}
const list: any[] = [];
for (let i = 0; i < 12; i++) list.push(i % 3 === 0 ? { id: i, tags: ["t" + i] } : i % 3 === 1 ? { id: i } : { name: "n" + i });
console.log(total(list));
console.log(total(JSON.parse('[{"id":1,"tags":["a","b"]},{"id":2},{"tags":["c"]},{}]')));
