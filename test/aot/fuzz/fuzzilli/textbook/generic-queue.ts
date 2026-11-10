class Queue<T> {
  private items: T[] = [];
  private head = 0;
  push(one: T): void {
    this.items.push(one);
  }
  shift(): T | undefined {
    return this.head < this.items.length ? this.items[this.head++] : undefined;
  }
  get size(): number {
    return this.items.length - this.head;
  }
}
const queue = new Queue<number>();
for (let i = 0; i < 4; i++) queue.push(i * i);
console.log(queue.shift(), queue.shift(), queue.size);
