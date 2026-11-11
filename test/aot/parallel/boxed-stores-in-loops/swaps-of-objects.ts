interface Item {
  key: number;
  name: string;
}

function items(count: number): Item[] {
  const list: Item[] = [];
  for (let i = 0; i < count; i++) list.push({ key: (i * 7919) % 101, name: `n${i}` });
  return list;
}

function show(list: (Item | null | undefined)[]): string {
  const parts: string[] = [];
  for (let i = 0; i < list.length; i++) parts.push(i in list ? (list[i] ? list[i]!.key + list[i]!.name : String(list[i])) : "hole");
  return `${list.length}[${parts.join(" ")}]`;
}

class Sorter {
  private list: Item[];
  constructor(list: Item[]) {
    this.list = list;
  }
  insertion(): Item[] {
    const list = this.list;
    for (let i = 1; i < list.length; i++) {
      for (let j = i; j > 0 && list[j - 1].key > list[j].key; j--) [list[j - 1], list[j]] = [list[j], list[j - 1]];
    }
    return list;
  }
  selection(): Item[] {
    const list = this.list;
    for (let i = 0; i < list.length; i++) {
      let least = i;
      for (let j = i + 1; j < list.length; j++) if (list[j].key < list[least].key) least = j;
      const held = list[i];
      list[i] = list[least];
      list[least] = held;
    }
    return list;
  }
  reverse(): Item[] {
    const list = this.list;
    for (let i = 0, j = list.length - 1; i < j; i++, j--) [list[i], list[j]] = [list[j], list[i]];
    return list;
  }
  shuffle(seed: number): Item[] {
    const list = this.list;
    for (let i = list.length - 1; i > 0; i--) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const j = seed % (i + 1);
      const held = list[i];
      list[i] = list[j];
      list[j] = held;
    }
    return list;
  }
  siftDown(): Item[] {
    const list = this.list;
    let i = 0;
    for (;;) {
      let least = i;
      const left = 2 * i + 1;
      const right = left + 1;
      if (left < list.length && list[left].key < list[least].key) least = left;
      if (right < list.length && list[right].key < list[least].key) least = right;
      if (least === i) break;
      [list[least], list[i]] = [list[i], list[least]];
      i = least;
    }
    return list;
  }
  pastTheEnd(count: number): Item[] {
    const list = this.list;
    for (let i = 0; i < count; i++) list[i] = list[i + 1];
    return list;
  }
  fillWith(item: Item | null | undefined, from: number): Item[] {
    const list = this.list;
    for (let i = from; i < list.length; i++) list[i] = item as Item;
    return list;
  }
}

for (const count of [0, 1, 2, 17, 60]) {
  console.log(show(new Sorter(items(count)).insertion()));
  console.log(show(new Sorter(items(count)).selection()));
  console.log(show(new Sorter(items(count)).reverse()));
  console.log(show(new Sorter(items(count)).shuffle(7)));
  if (count) console.log(show(new Sorter([{ key: 500, name: "top" }, ...items(count)]).siftDown()));
}
console.log(show(new Sorter(items(4)).pastTheEnd(3)), show(new Sorter(items(4)).pastTheEnd(4)), show(new Sorter(items(4)).pastTheEnd(6)));
console.log(show(new Sorter(items(4)).fillWith(null, 1)), show(new Sorter(items(4)).fillWith(undefined, 0)), show(new Sorter(items(3)).fillWith({ key: 1, name: "one" }, -2)));

function attempt(run: () => Item[]): string {
  try {
    return show(run());
  } catch (error) {
    return (error as Error).name;
  }
}
const frozen = Object.freeze(items(5)) as Item[];
console.log(attempt(() => new Sorter(frozen).reverse()), show(frozen));
const sealed = Object.seal(items(5));
console.log(attempt(() => new Sorter(sealed).reverse()), attempt(() => new Sorter(sealed).pastTheEnd(6)), show(sealed));
const holed = items(6);
delete holed[2];
console.log(attempt(() => new Sorter(holed).reverse()), attempt(() => new Sorter(holed).insertion()), show(holed));
const guarded = items(5);
let stores = 0;
Object.defineProperty(guarded, 1, { get: () => ({ key: 3, name: "got" }), set: () => void stores++, configurable: true });
console.log(attempt(() => new Sorter(guarded).reverse()), stores);
const nulls = items(4);
nulls[2] = null as any;
console.log(attempt(() => new Sorter(nulls).insertion()), show(nulls));

function between(first: Item[], second: Item[]): string {
  for (let i = 0; i < first.length; i++) {
    const held = first[i];
    first[i] = second[i];
    second[i] = held;
  }
  return `${show(first)} ${show(second)}`;
}
const one = items(5);
console.log(between(one, items(3)), between(one, one));

let kept: Item[] = [];
for (let round = 0; round < 40; round++) {
  const fresh = items(300);
  new Sorter(fresh).shuffle(round);
  if (round % 8 === 0) kept = new Sorter(fresh).reverse();
}
console.log(kept.length, kept[0].name, kept[299].name, kept.every(item => item.name === `n${items(300).findIndex(other => other.name === item.name)}`));
