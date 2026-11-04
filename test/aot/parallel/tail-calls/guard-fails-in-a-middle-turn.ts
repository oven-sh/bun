// a middle turn of a self tail call is handed an object of another class with the same members
class Item {
  next: Item | null;
  size: number;
  constructor(next: Item | null, size: number) {
    this.next = next;
    this.size = size;
  }
}
class Other {
  size: number;
  next: Item | null;
  constructor(next: Item | null, size: number) {
    this.size = size;
    this.next = next;
  }
}
function total(item: Item | null, sum: number): number {
  if (!item) return sum;
  return total(item.next, sum + item.size);
}
function chain(length: number, tail: Item | null): Item | null {
  let item = tail;
  for (let i = 1; i <= length; i++) item = new Item(item, i);
  return item;
}
function deed(middle: boolean) {
  const tail = chain(3, null);
  return String(total(chain(3, middle ? (new Other(tail, 100) as Item) : tail), 0));
}
console.log(deed(false));
for (let i = 0; i < 5; i++) console.log(deed(false));
console.log(deed(true));
console.log(deed(false));
