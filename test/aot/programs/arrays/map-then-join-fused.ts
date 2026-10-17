// IR+ ^function \d+ "Array\$mapJoin" .*\n  b0\(.*\n    v
interface Item {
  name: string;
}
const items: Item[] = [];
for (let i = 0; i < 5; i++) items.push({ name: "n" + i });

function render(list: Item[]): string {
  return `<ul>${list.map(item => `<li class="item-of-a-list">${item.name}</li>`).join("\n")}</ul>`;
}
console.log(render(items));
