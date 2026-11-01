// A generic class that the whole program instantiates with one class. Its type parameter stands for the objects of that class alone, so nothing is left to test on the way from `box` to `box.value.name`.
// IR-UNTIL ApplyFlowResults
// IR= 0 nameOf  = Check\b
// IR= 1 nameOfParsed  = Check\b
// STATISTIC: ConversionsOutsideFamily = 0
class Item {
  name: string;
  count: number;

  constructor(name: string, count: number) {
    this.name = name;
    this.count = count;
  }
}

class Special extends Item {
  extra: boolean;

  constructor(name: string, count: number, extra: boolean) {
    super(name, count);
    this.extra = extra;
  }
}

class Box<T> {
  value: T;

  constructor(value: T) {
    this.value = value;
  }

  get(): T {
    return this.value;
  }

  replace(value: T): T {
    const previous = this.value;
    this.value = value;
    return previous;
  }
}

function nameOf(box: Box<Item>): string {
  return box.value.name;
}

// What a parser made is no `Item`, so this test stays.
function nameOfParsed(value: any): unknown {
  const item: Item = value;
  return item.name;
}

function countOf(box: Box<Item>): number {
  return box.get().count;
}

function exchange(first: Box<Item>, second: Box<Item>): void {
  second.replace(first.replace(second.value));
}

function summarize(box: Box<Item | undefined>): string {
  const item = box.value;
  return item === undefined ? "empty" : item.name + ":" + item.count;
}

const first = new Box<Item>(new Item("first", 1));
const second = new Box<Item>(new Special("second", 2, true));
console.log(nameOf(first), nameOf(second), countOf(first), countOf(second));

exchange(first, second);
console.log(nameOf(first), nameOf(second), first.value instanceof Special, second.value instanceof Special);

const previous = first.replace(new Item("third", 3));
console.log(previous.name, previous.count, previous instanceof Special, nameOf(first), first.get() === first.value);

const optional = new Box<Item | undefined>(undefined);
console.log(summarize(optional), optional.get() === undefined);
optional.value = second.value;
console.log(summarize(optional), optional.get() === second.get());
console.log(optional.replace(undefined) === second.value, summarize(optional));

const cleared = new Box<Item | null>(null);
console.log(cleared.value === null, cleared.get() === null, cleared.value === undefined);
console.log(cleared.replace(previous) === null, cleared.value === previous, cleared.replace(null) === previous, cleared.get() === null);

let total = 0;
for (let i = 0; i < 1000; i++) {
  const box = i % 2 === 0 ? first : second;
  box.value.count += i;
  total += countOf(box) + nameOf(box).length;
}
console.log(total, first.value.count, second.value.count);

console.log(nameOfParsed(JSON.parse('{"name":"parsed"}')));
