// the last turn of a self tail call is handed a text where a number is declared
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
function chain(length: number, last: unknown): Item | null {
  let item: Item | null = new Item(null, last as number);
  for (let i = 1; i <= length; i++) item = new Item(item, i);
  return item;
}
function deed(last: unknown) {
  const answer = total(chain(3, last), 0);
  return typeof answer + " " + String(answer);
}
console.log(deed(1));
for (let i = 0; i < 5; i++) console.log(deed(i + 0.5));
console.log(deed("x"));
console.log(deed(null));
console.log(deed(2));
