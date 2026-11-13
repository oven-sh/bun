// A generic stack used with numbers alone in one, with texts in another
class Stack<T> {
  private items: T[] = [];
  constructor(...items: T[]) {
    for (const item of items) this.push(item);
  }
  push(item: T): number {
    return this.items.push(item);
  }
  pop(): T | undefined {
    return this.items.pop();
  }
  map<U>(call: (item: T, depth: number) => U): U[] {
    const out: U[] = [];
    for (let i = this.items.length - 1; i >= 0; i--) out.push(call(this.items[i], out.length));
    return out;
  }
}
function run(n: number): string {
  const numbers = new Stack<number>(n, n * 2, n * 3);
  const texts = new Stack("a" + n);
  texts.push("b");
  return [numbers.pop(), numbers.map((item, depth) => item * depth).join("+"), texts.map(text => text.length).join("+"), texts.pop(), numbers.push(1)].join();
}
console.log(run(1));
console.log(run(50));
console.log(run(0));
