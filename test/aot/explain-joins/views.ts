interface Item {
  name: string;
  count: number;
}
const items: Item[] = [];
for (let i = 0; i < 3; i++) items.push({ name: "n" + i, count: i });
const row = (item: Item): string => `<li class="item-of-the-list">${item.name}</li>`;
const separator = items.length > 5 ? ", " : "\n";

console.log(`<ul>${items.map(row).join("\n")}</ul>`);
const rows = items.map(item => row(item)).join("\n");
console.log(rows === "" ? "" : `<ul>${rows}</ul>`);
console.log(`<p>${items.map(item => item.name).join(", ")}</p>`);
console.log(items.map(row).join("\n").length);
console.log(`<p>${items.map(item => item.count).join("\n")}</p>`);
console.log(`<ul>${items.map(row).join(separator)}</ul>`);
console.log(`<ul>${items.map(row).join()}</ul>`);
console.log(`<ul>${items.map(row, items).join("\n")}</ul>`);
const mapped = items.map(row);
console.log(`<ul>${mapped.join("\n")}</ul>`, mapped.length);
const pick: (item: Item) => string = items.length > 5 ? row : item => row(item);
console.log(`<ul>${items.map(pick).join("\n")}</ul>`);
try {
  console.log(`<ul>${items.map(row).join("\n")}</ul>`);
} catch {}
