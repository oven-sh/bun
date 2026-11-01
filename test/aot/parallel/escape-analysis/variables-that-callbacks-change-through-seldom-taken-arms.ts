// A variable that a callback adds to has the same value whichever arm of the loop called the callback: lists of integers where fractions
// are expected, holes, lists that shrink or grow under the walk, elements of another kind, and a callback that throws.
type Entry = { weight: number };
function each<T>(list: T[], callback: (value: T, index: number) => void): void {
  for (let index = 0; index < list.length; index++) callback(list[index]!, index);
}
function total(list: number[]): number {
  let sum = 0;
  list.forEach(value => {
    sum += value;
  });
  return sum;
}
function totalAndCount(list: number[]): string {
  let sum = 0,
    count = 0;
  list.forEach(value => {
    sum += value;
    count++;
  });
  return sum + "/" + count;
}
function weigh(list: Entry[]): number {
  let sum = 0;
  each(list, entry => {
    sum += entry.weight;
  });
  return sum;
}
function shrink(list: number[]): string {
  let sum = 0,
    seen = 0;
  each(list, value => {
    seen++;
    if (value === 2) list.pop();
    sum += value === undefined ? 1000 : value;
  });
  return sum + "/" + seen;
}
function shrinkByMethod(list: number[]): string {
  let sum = 0,
    seen = 0;
  list.forEach(value => {
    seen++;
    if (value === 2) list.length = 3;
    sum += value;
  });
  return sum + "/" + seen;
}
function grow(list: number[]): string {
  let sum = 0,
    seen = 0;
  each(list, value => {
    seen++;
    if (list.length < 8) list.push(value + 0.5);
    sum += value;
  });
  return sum + "/" + seen;
}
function caught(list: number[]): string {
  let sum = 0;
  try {
    list.forEach(value => {
      sum += value;
      if (value > 2) throw new Error("over");
    });
  } catch (error) {
    return sum + ":" + (error as Error).message;
  }
  return sum + ":none";
}
function nested(lists: number[][]): number {
  let sum = 0;
  lists.forEach(list => {
    list.forEach(value => {
      sum += value;
    });
    sum += 100;
  });
  return sum;
}
function later(list: number[]): () => number {
  let sum = 0;
  list.forEach(value => {
    sum += value;
  });
  return () => sum++;
}
const out: string[] = [];
for (let round = 0; round < 3; round++) {
  const integers = [1, 2, 3, 4],
    fractions = [0.5, 1.5, 2.5],
    mixed = [1, 2.5, 3, 4.25];
  const holes = [1, , 3, , 5] as number[];
  const filled: number[] = [];
  for (let k = 0; k < 5 + round; k++) filled.push(k % 2 ? k : k / 4);
  out.push([total(integers), total(fractions), total(mixed), total(holes), total(filled), total([])].join());
  out.push([totalAndCount(integers), totalAndCount(holes), totalAndCount(filled)].join());
  out.push(
    [
      weigh([{ weight: 1 }, { weight: 2.5 }]),
      weigh([]),
      weigh([{ weight: round }, { weight: 2, extra: 1 } as Entry]),
    ].join(),
  );
  out.push(
    [shrink([1, 2, 3, 4]), shrink([2, 2, 2]), shrinkByMethod([1, 2, 3, 4, 5]), grow([1, 2]), grow([0.5])].join(),
  );
  out.push([caught(integers), caught(fractions), caught([1, 2])].join());
  out.push(String(nested([integers, fractions, holes, []])));
  const next = later(mixed);
  out.push([next(), next()].join());
}
console.log(out.join("\n"));
