// A helper makes an object and hands it to the callback it was passed. What becomes of the object is decided by the caller's callback: one reads it, one writes it, one keeps it, each in its own way.
function churn(depth: number): number {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
interface Temp {
  n: number;
  label: string;
}
function withTemp(i: number, use: (t: Temp) => unknown): number {
  const temp: Temp = { n: i, label: "temp" + i };
  use(temp);
  return temp.n;
}
function withTempTwice(i: number, use: (t: Temp) => unknown): number {
  return withTemp(i, use) + withTemp(i + 1, use);
}
function answersOf(count: number, f: (t: Temp) => unknown): unknown[] {
  const out: unknown[] = [];
  for (let i = 0; i < count; i++) out.push(f({ n: i, label: "answer" + i }));
  return out;
}
const inModule: Temp[] = [];
let lastInModule: Temp | null = null;
function keepInModule(t: Temp): void {
  lastInModule = t;
}
class Shelf {
  items: Temp[] = [];
  only: Temp | null = null;
  keep(t: Temp): void {
    this.items.push(t);
    this.only = t;
  }
}
function run(): void {
  let sum = 0;
  const local: Temp[] = [];
  const box: { held: Temp | null } = { held: null };
  let thunk: () => string = () => "nothing";
  const shelf = new Shelf();
  const set = new Set<Temp>();
  const trapped: unknown[][] = [];
  const throughProxy = new Proxy((t: Temp) => t.n, {
    apply(target, self, args) {
      trapped.push(args);
      return Reflect.apply(target, self, args);
    },
  });
  const table: ((t: Temp) => unknown)[] = [t => t.n, t => local.push(t)];
  for (let i = 0; i < 400; i++) {
    sum += withTempTwice(i, t => {
      sum += t.n;
    });
    sum += withTempTwice(i, t => {
      t.n = -t.n;
    });
    if (i % 100 === 10) sum += withTempTwice(i, t => inModule.push(t));
    if (i % 100 === 20) sum += withTempTwice(i, keepInModule);
    if (i % 100 === 30) sum += withTempTwice(i, t => local.push(t));
    if (i % 100 === 40) {
      sum += withTempTwice(i, t => {
        box.held = t;
      });
    }
    if (i % 100 === 50) {
      sum += withTempTwice(i, t => {
        thunk = () => t.label;
      });
    }
    if (i % 100 === 60) sum += withTempTwice(i, shelf.keep.bind(shelf));
    if (i % 100 === 70) sum += withTempTwice(i, set.add.bind(set));
    if (i % 100 === 80) sum += withTempTwice(i, throughProxy);
    sum += withTempTwice(i, table[i % 100 === 90 ? 1 : 0]);
  }
  console.log(sum, churn(60));
  const labels = (list: Iterable<Temp>) => Array.from(list, t => t.label + "=" + t.n).join();
  console.log(labels(inModule));
  console.log(lastInModule!.label, labels(local));
  console.log(box.held!.label, thunk(), labels(shelf.items), shelf.only === shelf.items[shelf.items.length - 1]);
  console.log(labels(set), trapped.map(args => (args[0] as Temp).label).join());
}
run();
const same = answersOf(300, t => t) as Temp[];
const numbers = answersOf(300, t => t.n) as number[];
const wrapped = answersOf(300, t => ({ inner: t })) as { inner: Temp }[];
const thunks = answersOf(300, t => () => t) as (() => Temp)[];
console.log(churn(60), same[299].label, numbers[299], wrapped[150].inner.label, thunks[7]().label, thunks[7]() === thunks[7](), same[1] === same[2]);

// The elements of the caller's array go to the caller's callback; the callback changes the array while the helper walks it.
function each<T>(list: T[], visit: (item: T, index: number) => void): void {
  for (let i = 0; i < list.length; i++) visit(list[i], i);
}
const seen: string[] = [];
const growing: (number | string | Temp)[] = [1, 2, 3];
each(growing, (item, index) => {
  seen.push(typeof item === "object" ? item.label : typeof item + item);
  if (index === 0) growing.push("four");
  if (index === 1) growing.push({ n: 5, label: "five" });
  if (index === 2) growing[3] = 4.5;
});
const shrinking = [{ n: 1, label: "a" }, { n: 2, label: "b" }, { n: 3, label: "c" }];
const popped: Temp[] = [];
each(shrinking, item => {
  seen.push(item.label);
  popped.push(shrinking.pop()!);
});
console.log(seen.join(), churn(40), popped.map(t => t.label).join());
