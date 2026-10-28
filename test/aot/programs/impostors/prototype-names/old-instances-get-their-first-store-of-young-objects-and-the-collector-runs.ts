// 20000 instances survive two full collections with empty optional slots. Then each gets its first store: a fresh object, a fresh string, a fresh closure, a fresh array, a boxed number.
// Nothing else refers to those values. Garbage is made until the collector has run many times, and every value must still be there and be right.
class Holder {
  declare id: number;
  declare child?: { n: number; pad: number };
  declare name?: string;
  declare run?: () => number;
  declare list?: number[];
  declare ratio?: number;
  declare next?: Holder;
  constructor(id: number) {
    this.id = id;
  }
}
interface Bag {
  id: number;
  child?: { n: number; pad: number };
  name?: string;
}
function fill(holder: Holder, i: number) {
  holder.child = { n: i, pad: -i };
  holder.name = "name " + i + "!";
  holder.run = () => i * 3;
  holder.list = [i, i + 1];
  holder.ratio = i + 0.25;
  holder.next = new Holder(-i);
}
function fillBag(bag: Bag, i: number) {
  bag.child = { n: i, pad: -i };
  bag.name = "bag " + i;
}
function check(holder: Holder, i: number) {
  return (
    holder.child!.n === i &&
    holder.child!.pad === -i &&
    holder.name === "name " + i + "!" &&
    holder.run!() === i * 3 &&
    holder.list!.length === 2 &&
    holder.list![1] === i + 1 &&
    holder.ratio === i + 0.25 &&
    holder.next!.id === -i &&
    holder.next!.child === undefined
  );
}
function churn(rounds: number) {
  let sum = 0;
  for (let i = 0; i < rounds; i++) {
    const junk = { n: i, pad: i, more: "j" + (i & 1023), list: [i] };
    sum += junk.n & 1;
  }
  return sum;
}

const holders: Holder[] = [];
const bags: Bag[] = [];
for (let i = 0; i < 20000; i++) {
  holders.push(new Holder(i));
  bags.push({ id: i });
}
Bun.gc(true);
Bun.gc(true);
for (let i = 0; i < holders.length; i++) {
  fill(holders[i], i);
  fillBag(bags[i], i);
}
console.log("garbage", churn(3_000_000));
let right = 0;
for (let i = 0; i < holders.length; i++) if (check(holders[i], i) && bags[i].child!.n === i && bags[i].name === "bag " + i) right++;
console.log("after small collections:", right);
Bun.gc(true);
console.log("garbage", churn(500_000));
right = 0;
for (let i = 0; i < holders.length; i++) if (check(holders[i], i) && bags[i].child!.pad === -i) right++;
console.log("after a full collection:", right);
for (let i = 0; i < holders.length; i++) {
  delete holders[i].child;
  holders[i].next!.child = { n: i, pad: 0 };
}
console.log("garbage", churn(3_000_000));
right = 0;
for (let i = 0; i < holders.length; i++) if (holders[i].child === undefined && holders[i].next!.child!.n === i) right++;
console.log("first stores one level down:", right, Object.keys(holders[7]).join(), Object.keys(holders[7].next!).join());
