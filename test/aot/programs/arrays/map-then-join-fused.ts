// `list.map(f).join(separator)` runs as one loop that appends each piece to a string builder: the array of pieces is never allocated.
// IR= 0 render NewArray(Like|WithCapacity)
// IR= 1 render StringBuilderBegin
// IR= 0 shortPieces NewArray(Like|WithCapacity)
// IR= 1 shortPieces StringBuilderBegin
// IR= 0 readAtOnce NewArray(Like|WithCapacity)
// IR= 1 readAtOnce StringBuilderBegin
// IR= 0 numbers NewArray(Like|WithCapacity)
// IR= 1 numbers StringBuilderBegin
// IR= 0 separatorNotLiteral NewArray(Like|WithCapacity)
// IR= 1 separatorNotLiteral StringBuilderBegin
// IR= 0 noSeparator NewArray(Like|WithCapacity)
// IR= 1 noSeparator StringBuilderBegin
interface Item {
  name: string;
}
const items: Item[] = [];
for (let i = 0; i < 5; i++) items.push({ name: "n" + i });

function render(list: Item[]): string {
  return `<ul>${list.map(item => `<li class="item-of-a-list">${item.name}</li>`).join("\n")}</ul>`;
}
function shortPieces(list: Item[]): string {
  return `<p>${list.map(item => item.name).join(", ")}</p>`;
}
function readAtOnce(list: Item[]): number {
  return list.map(item => `<li class="item-of-a-list">${item.name}</li>`).join("\n").length;
}
function numbers(list: Item[]): string {
  return `<p>${list.map(item => item.name.length).join("\n")}</p>`;
}
const row = (item: Item): string => `<li class="item-of-a-list">${item.name}</li>`;
function separatorNotLiteral(list: Item[]): string {
  const separator = list.length > 9 ? ", " : "\n";
  return `<ul>${list.map(row).join(separator)}</ul>`;
}
function noSeparator(list: Item[]): string {
  return `<ul>${list.map(row).join()}</ul>`;
}
// A function that runs at most once is left as written, so each is called from two places.
console.log(render(items), shortPieces(items), readAtOnce(items), numbers(items));
console.log(separatorNotLiteral(items), noSeparator(items));
console.log(render([]), shortPieces([]), readAtOnce([]), numbers([]), separatorNotLiteral([]), noSeparator([]));
