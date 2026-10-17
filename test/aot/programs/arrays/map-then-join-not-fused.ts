// IR- ^function \d+ "Array\$mapJoin" .*\n  b0\(.*\n    v
interface Item {
  name: string;
}
const items: Item[] = [];
for (let i = 0; i < 5; i++) items.push({ name: "n" + i });

function shortPieces(list: Item[]): string {
  return `<p>${list.map(item => item.name).join(", ")}</p>`;
}
function readAtOnce(list: Item[]): number {
  return list.map(item => `<li class="item-of-a-list">${item.name}</li>`).join("\n").length;
}
function numbers(list: Item[]): string {
  return `<p>${list.map(item => item.name.length).join("\n")}</p>`;
}
function usedTwice(list: Item[]): string {
  const mapped = list.map(item => `<li class="item-of-a-list">${item.name}</li>`);
  return `<ul>${mapped.join("\n")}</ul>${mapped.length}`;
}
console.log(shortPieces(items), readAtOnce(items), numbers(items), usedTwice(items));
