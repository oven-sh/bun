// Where `list.map(f).join(separator)` stays as written: the array is used again, `map` gets a receiver for its callback, the callback is one of two functions, the separator may be no string, a handler covers the calls.
// IR= 0 usedTwice StringBuilderBegin
// IR= 0 thisArgument StringBuilderBegin
// IR= 0 unknownCallback StringBuilderBegin
// IR= 0 separatorOfAnyKind StringBuilderBegin
// IR= 0 insideTry StringBuilderBegin
interface Item {
  name: string;
}
const items: Item[] = [];
for (let i = 0; i < 5; i++) items.push({ name: "n" + i });

function usedTwice(list: Item[]): string {
  const mapped = list.map(item => `<li class="item-of-a-list">${item.name}</li>`);
  return `<ul>${mapped.join("\n")}</ul>${mapped.length}`;
}
const row = (item: Item): string => `<li class="item-of-a-list">${item.name}</li>`;
function thisArgument(list: Item[]): string {
  return `<ul>${list.map(row, list).join("\n")}</ul>`;
}
function unknownCallback(list: Item[]): string {
  const pick: (item: Item) => string = list.length > 9 ? row : item => row(item);
  return `<ul>${list.map(pick).join("\n")}</ul>`;
}
function separatorOfAnyKind(list: Item[], separator: any): string {
  return `<ul>${list.map(row).join(separator)}</ul>`;
}
function insideTry(list: Item[]): string {
  try {
    return `<ul>${list.map(row).join("\n")}</ul>`;
  } catch {
    return "";
  }
}
// A function that runs at most once is left as written whatever it holds, so each is called from two places.
console.log(usedTwice(items), thisArgument(items), unknownCallback(items));
console.log(separatorOfAnyKind(items, 1), separatorOfAnyKind(items, "-"), separatorOfAnyKind(items, undefined), insideTry(items));
console.log(usedTwice([]), thisArgument([]), unknownCallback([]), separatorOfAnyKind([], 1), insideTry([]));
