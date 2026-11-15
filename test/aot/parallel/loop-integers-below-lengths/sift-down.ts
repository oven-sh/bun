interface Item {
  key: number;
  name: string;
}

class Heap {
  private items: Item[] = [];
  get size(): number {
    return this.items.length;
  }
  push(item: Item): void {
    const items = this.items;
    items.push(item);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent].key <= items[i].key) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }
  pop(): Item {
    const items = this.items;
    const first = items[0];
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        let least = i;
        const left = 2 * i + 1;
        const right = left + 1;
        if (left < items.length && items[left].key < items[least].key) least = left;
        if (right < items.length && items[right].key < items[least].key) least = right;
        if (least === i) break;
        [items[least], items[i]] = [items[i], items[least]];
        i = least;
      }
    }
    return first;
  }
}

const heap = new Heap();
for (let k = 0; k < 40; k++) heap.push({ key: (k * 7919) % 101, name: `n${k}` });
let order = "";
while (heap.size) {
  const { key, name } = heap.pop();
  order += `${key}${name} `;
}
console.log(order);

function doubled(list: number[]): string {
  let i = 1;
  let turns = 0;
  while (2 * i < list.length) {
    i = 2 * i;
    turns++;
  }
  return `${i} ${turns}`;
}
for (const length of [0, 1, 2, 3, 17, 1000]) console.log(doubled(new Array(length).fill(0)));

function beyondInt32(limit: number): string {
  let i = 3;
  let turns = 0;
  while (3 * i < limit && 3 * i < 9007199254740991) {
    i = 3 * i;
    turns++;
  }
  return `${i} ${turns} ${i | 0} ${i % 7}`;
}
for (const limit of [10, 2147483647, 4294967296, 1e15, 1e300, NaN]) console.log(beyondInt32(limit));

function steps(text: string, step: number): string {
  let i = 0;
  let found = "";
  while (i + 4 <= text.length) {
    found += text[i] + text[i + 3];
    i += step > 2 ? step : 1;
  }
  return `${i} ${found}`;
}
for (const step of [1, 3, 5]) console.log(steps("abcdefghijklmnop", step), steps("abc", step));

function backward(list: number[]): string {
  let i = list.length;
  let sum = 0;
  while (i - 2 >= 0) {
    sum += list[i - 2] - list[i - 1];
    i -= 2;
  }
  return `${i} ${sum}`;
}
for (const length of [0, 1, 2, 9, 10]) console.log(backward(Array.from({ length }, (_, k) => k * k)));

function negated(list: number[]): string {
  let i = 0;
  let turns = 0;
  let zeros = 0;
  while (-1 * i + 1 < list.length && turns < 6) {
    if (Object.is(-1 * i, -0)) zeros++;
    i = turns % 2 ? -1 * i : i - 1;
    turns++;
  }
  return `${i} ${turns} ${zeros} ${Object.is(i, -0)}`;
}
console.log(negated([1, 2, 3]), negated(new Array(40).fill(0)), negated([]));

function pastTheLength(limit: number, list: number[]): string {
  let i = 0;
  let turns = 0;
  while ((i + 1) * 5 < limit || i + 1 < list.length) {
    i = (i + 1) * 5;
    turns++;
  }
  return `${i} ${turns} ${i > 4294967295}`;
}
console.log(pastTheLength(0, [1, 2, 3]), pastTheLength(1e12, [1]), pastTheLength(1e17, []));
