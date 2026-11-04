// a method calls itself on the next object in tail position a million times
class Cell {
  next: Cell | null = null;
  value: number;
  constructor(value: number) {
    this.value = value;
  }
  sum(acc: number): number {
    const next = this.next;
    if (!next) return acc + this.value;
    return next.sum(acc + this.value);
  }
}
function deed(length: number) {
  const head = new Cell(1);
  let last = head;
  for (let i = 1; i < length; i++) last = last.next = new Cell(i & 3);
  return String(head.sum(0));
}
console.log(deed(3));
for (let i = 0; i < 5; i++) console.log(deed(1000 + i));
console.log(deed(1000000));
