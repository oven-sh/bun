// the first turn of a self tail call is handed a number where an Item is declared
class Item {
  next: Item | null;
  size: number;
  constructor(next: Item | null, size: number) {
    this.next = next;
    this.size = size;
  }
}
function total(item: Item | null, sum: number): number {
  if (!item) return sum;
  return total(item.next, sum + item.size);
}
function chain(length: number): Item | null {
  let item: Item | null = null;
  for (let i = 1; i <= length; i++) item = new Item(item, i);
  return item;
}
function deed(first: unknown) {
  return String(total(first as Item, 1));
}
console.log(deed(chain(3)));
for (let i = 0; i < 5; i++) console.log(deed(chain(10 + i)));
console.log(deed(5));
console.log(deed(chain(4)));
