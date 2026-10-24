// The callback of Array.prototype.forEach and the comparator of Array.prototype.sort read an optional field of the elements.
// In the middle of the walk the callback itself puts a member of that name on the prototype: the very next read must see it.
// In this twin the optional fields are class fields without `declare`: they are defined at birth and the constructor deletes them, so the slots are declared and empty. Every instance may reach unknown code.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
class Row {
  declare id: number;
  rank?: number;
  constructor(id: number) {
    delete this.rank;
    handOver(this);
    this.id = id;
  }
}
class Item {
  declare id: number;
  weight?: number;
  constructor(id: number) {
    delete this.weight;
    handOver(this);
    this.id = id;
  }
}
function holderOf(value: object): any {
  return Reflect.getPrototypeOf(value);
}
function walk(rows: Row[], changeAt: number) {
  let sum = 0;
  const around: string[] = [];
  rows.forEach((row, index) => {
    const before = row.rank;
    sum += before ?? 1;
    if (index === changeAt) {
      holderOf(row)["ra" + "nk".slice(0)] = 50;
      around.push(`${before} ${row.rank}`);
    }
    sum += row.rank ?? 1;
  });
  return `${sum} ${around.join()}`;
}
function order(items: Item[], changeAt: number) {
  let comparisons = 0;
  const sorted = items.slice().sort((a, b) => {
    if (++comparisons === changeAt) {
      Object.defineProperty(holderOf(a), "weight", {
        get(this: Item) {
          return -this.id;
        },
        configurable: true,
      });
    }
    return (a.weight ?? a.id) - (b.weight ?? b.id);
  });
  return sorted.map(item => item.id).join();
}

const rows: Row[] = [];
for (let i = 0; i < 3000; i++) rows.push(new Row(i));
rows[10].rank = 7;
rows[2990].rank = 7;
console.log("no change:", walk(rows, -1));
console.log("change at 1500:", walk(rows, 1500));
console.log("afterwards:", walk(rows, -1), rows[0].rank, rows[10].rank, new Row(1).rank, Object.keys(rows[0]).join());
delete holderOf(rows[0]).rank;
console.log("gone again:", walk(rows, -1));

const items: Item[] = [];
for (let i = 0; i < 12; i++) items.push(new Item((i * 7) % 12));
for (let i = 0; i < 300; i++) order(items, -1);
console.log("no change:", order(items, -1));
const changed = order(items, 1);
console.log("the getter is there from the first comparison:", changed);
console.log("afterwards:", order(items, -1), items[0].weight, new Item(5).weight);
delete holderOf(items[0]).weight;
console.log("gone again:", order(items, -1), items[0].weight);
