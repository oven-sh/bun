// Typed readers walk lists of numbers whose storage can hold any value: what general code collected, what once held a text, what holds a NaN, a hole, -0, whole numbers beside fractions,
// and lists that stop being lists of numbers, grow, shrink or change their storage in the middle of a walk.
function collect(record: any): any {
  const list = [];
  for (const key in record) list.push(record[key]);
  return list;
}
function onceHeldText(): number[] {
  const list: (number | string)[] = [0.5, 1, 2.5, 3, 4.5, 5, 6.5, "7"];
  list[7] = 7;
  return list as number[];
}
function withHoles(): number[] {
  const list = onceHeldText();
  delete list[2];
  delete list[5];
  return list;
}
const lists: number[][] = [
  [0.5, 1, 2.5, 3, 4.5, 5, 6.5, 7],
  collect({ a: 0.5, b: 1, c: 2.5, d: 3, e: 4.5, f: 5, g: 6.5, h: 7 }),
  onceHeldText(),
  collect({ a: 0.5, b: NaN, c: -0, d: 3, e: Infinity, f: -Infinity, g: 2 ** 31, h: -(2 ** 31) }),
  withHoles(),
  collect({ a: 1, b: 2, c: 3 }),
  collect({}),
  collect({ a: 0.5, b: "1", c: 2.5 }),
  collect({ a: 0.5, b: undefined, c: null, d: 4n, e: { valueOf: () => 5 } }).slice(0, 3),
  Object.values({ a: 1.25, b: 2, c: -0 }),
  "0.5,1,x,3".split(",").map(Number),
];

function indexed(list: number[]): number {
  let total = 0;
  for (let index = 0; index < list.length; index++) total += list[index];
  return total;
}
function walked(list: number[]): number {
  let total = 0;
  for (const value of list) total += value;
  return total;
}
function backwards(list: number[]): number {
  let total = 1;
  for (let index = list.length - 1; index >= 0; index--) total = total / 2 + list[index];
  return total;
}
function pairs(list: number[]): number {
  let total = 0;
  for (let index = 0; index + 1 < list.length; index++) total += list[index] * list[index + 1];
  return total;
}
function large(list: number[]): number[] {
  return list.filter(value => value > 2);
}
function doubled(list: number[]): number[] {
  return list.map(value => value * 2);
}
function folded(list: number[]): number {
  return list.reduce((total, value) => total + value, 0);
}
function found(list: number[]): number | undefined {
  return list.find(value => value > 4);
}
function everyOne(list: number[]): boolean {
  return list.every(value => value === value);
}
function counted(list: number[]): number {
  let count = 0;
  list.forEach(value => {
    if (1 / value < 0) count++;
  });
  return count;
}
function show(value: unknown): string {
  if (Array.isArray(value)) return "[" + Object.keys(value).map(key => key + ":" + show(value[key as any])) + "]";
  return Object.is(value, -0) ? "-0" : String(value);
}
function attempt(run: () => unknown): string {
  try {
    return show(run());
  } catch (error) {
    return (error as Error).constructor.name;
  }
}

const readers = [indexed, walked, backwards, pairs, large, doubled, folded, found, everyOne, counted];
const seen = new Map<string, number>();
for (let turn = 0; turn < 300; turn++) {
  for (let which = 0; which < lists.length; which++) {
    for (const reader of readers) {
      const line = which + " " + reader.name + " " + attempt(() => reader(lists[which]));
      seen.set(line, (seen.get(line) ?? 0) + 1);
    }
  }
}
for (const [line, count] of seen) console.log(count, line);

// The list changes under the walk.
function changedWhileFolded(change: (list: any[], index: number) => void): string {
  const texts: string[] = [];
  for (let turn = 0; turn < 40; turn++) {
    const list = onceHeldText();
    texts.push(attempt(() => list.reduce((total, value, index) => (change(list, index), total + value), 0)));
    const other = onceHeldText();
    texts.push(
      attempt(() => {
        let total = 0;
        for (let index = 0; index < other.length; index++) {
          total += other[index];
          change(other, index);
        }
        return total;
      }),
    );
    const third = onceHeldText();
    texts.push(
      attempt(() => {
        let total = 0;
        for (const value of third) {
          total += value;
          if (third.length < 20) change(third, third.indexOf(value));
        }
        return total;
      }),
    );
  }
  return [...new Set(texts)].join(" ");
}
console.log(changedWhileFolded((list, index) => index === 2 && (list[5] = "five")));
console.log(changedWhileFolded((list, index) => index === 2 && (list.length = 4)));
console.log(changedWhileFolded((list, index) => index === 2 && list.push(100.5)));
console.log(changedWhileFolded((list, index) => index === 2 && delete list[6]));
console.log(changedWhileFolded((list, index) => index === 2 && (list[5000] = 1)));
console.log(changedWhileFolded((list, index) => index === 2 && Object.defineProperty(list, 4, { get: () => 1000 })));
console.log(changedWhileFolded((list, index) => index === 2 && Object.freeze(list)));
console.log(changedWhileFolded((list, index) => index === 2 && list.fill(1.5)));
console.log(changedWhileFolded((list, index) => index === 2 && list.reverse()));
