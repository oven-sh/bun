interface Item {
  id: number;
  note?: string;
  count?: number;
  next?: Item;
}
function make(id: number, full: boolean): Item {
  const item: Item = { id, note: undefined, count: full ? id : undefined };
  if (full) item.note = "n" + id;
  return item;
}
function short(id: number): Item {
  return { id };
}
function spread(item: Item): Item {
  return { ...item, count: (item.count ?? 0) + 1 };
}
const items = [make(1, true), make(2, false), short(3), spread(make(4, false)), spread(short(5))];
function show(list: Item[]): string {
  let text = "";
  for (const item of list)
    text +=
      item.id +
      (item.note ?? "-") +
      (item.count === undefined ? "?" : item.count) +
      ("note" in item) +
      (item.next ? item.next.id : 0) +
      " ";
  return text;
}
console.log(show(items), JSON.stringify(items));
items[2].next = items[0];
items[1].note = "late";
delete items[0].note;
items[3].count = undefined;
console.log(show(items), Object.keys(items[2]).join());
