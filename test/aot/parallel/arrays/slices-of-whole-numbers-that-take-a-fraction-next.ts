const text = (value: unknown) => (Object.is(value, -0) ? "-0" : String(value));
const show = (list: unknown[]) => {
  const shown: string[] = [];
  for (let i = 0; i < list.length; i++) shown.push(i in list ? text(list[i]) : "hole");
  return list.length + ": " + shown.join(" ");
};

function copyAndStore(list: number[], at: number, value: number) {
  const copy = list.slice();
  copy[at] = value;
  return copy;
}
function partAndStore(list: number[], from: number, to: number, at: number, value: number) {
  const copy = list.slice(from, to);
  copy[at] = value;
  return copy;
}
function tailAndStore(list: number[], from: number, value: number) {
  const copy = list.slice(from);
  copy[0] = value;
  return copy;
}
function copyAndSum(list: number[], scale: number) {
  const copy = list.slice();
  let sum = 0;
  for (let i = 0; i < copy.length; i++) {
    copy[i] = (copy[i] ?? 100) * scale;
    sum += copy[i];
  }
  return sum;
}

const count = (length: number) => Array.from({ length }, (_, k) => k - 2);
const lists: Record<string, number[]> = {
  none: [],
  one: [7],
  two: [7, -8],
  three: [1, 2, 3],
  eight: [1, 2, 3, 4, 5, 6, 7, 8],
  extremes: [2147483647, -2147483648, 0, -1],
  holeFirst: [, 2, 3] as number[],
  holeLast: [1, 2, ,] as number[],
  holes: [1, , 3, , 5, , 7] as number[],
  onlyAHole: new Array<number>(1),
  sixtyThree: count(63),
  sixtyFour: count(64),
  sixtyFive: count(65),
  long: count(300),
  fractions: [1.5, 2.5, -0, NaN, Infinity],
  fractionsWithAHole: [1.5, , 3.5] as number[],
  oneFraction: [0.25],
  texts: ["a", "b", "c"] as any,
  oneText: ["a"] as any,
  mixed: [1, "two", null, undefined, { three: 3 }.three] as any,
};
const ranges = [
  [0, 1],
  [1, 2],
  [1, 3],
  [0, -1],
  [-3, -1],
  [2, 1],
  [0, 1000],
  [-1000, 2],
  [1, 66],
];

for (let round = 0; round < 3; round++) {
  for (const [name, list] of Object.entries(lists)) {
    const before = show(list);
    console.log(name, "copy", show(copyAndStore(list, 1, round + 0.5)));
    console.log(name, "copy, a whole number", show(copyAndStore(list, 0, round)));
    console.log(name, "copy, behind the end", show(copyAndStore(list, list.length + 1, 0.5)));
    for (const from of [1, -2, 1000]) console.log(name, "tail", from, show(tailAndStore(list, from, 0.25)));
    for (const [from, to] of ranges) console.log(name, "part", from, to, show(partAndStore(list, from, to, 0, 0.75)));
    console.log(name, "sum", copyAndSum(list, 0.5), copyAndSum(list, 2));
    if (show(list) !== before) console.log(name, "CHANGED", show(list));
  }
}

const named: number[] & { label?: string } = [1, 2, 3];
named.label = "kept on the list, not on its copy";
console.log(show(copyAndStore(named, 1, 0.5)), (copyAndStore(named, 1, 0.5) as typeof named).label);

const frozen = Object.freeze([1, 2, 3]) as number[];
console.log(show(copyAndStore(frozen, 1, 0.5)), Object.isFrozen(copyAndStore(frozen, 1, 0.5)));

class Row extends Array<number> {}
const row = Row.from([1, 2, 3]) as Row;
console.log(show(copyAndStore(row, 1, 0.5)), copyAndStore(row, 1, 0.5) instanceof Row);

const grown = [1, 2, 3];
grown.length = 6;
console.log(show(copyAndStore(grown, 4, 0.5)));

const sparse = [1, 2, 3];
sparse[100000] = 4;
const copyOfSparse = copyAndStore(sparse, 1, 0.5);
console.log(copyOfSparse.length, copyOfSparse[1], copyOfSparse[100000]);

const store = (copy: number[], at: number, value: number) => {
  copy[at] = value;
  return show(copy);
};
const wholeNone: number[] = [];
const wholeOne: number[] = [7];
const wholeTwo: number[] = [7, -8];
const wholeThree: number[] = [1, 2, 3];
const wholeFour: number[] = [2147483647, -2147483648, 0, -1];
const wholeEight: number[] = [1, 2, 3, 4, 5, 6, 7, 8];
const wholeNine: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const wholeBehindAHole = [, 2, 3] as number[];
const wholeBeforeAHole = [1, 2, ,] as number[];
const wholeBetweenHoles = [, 2, , 4, , 6, , 8, 9, ,] as number[];
const wholeAndLong: number[] = [];
for (let k = 0; k < 70; k++) wholeAndLong.push(k);
for (let round = 0; round < 3; round++) {
  console.log(store(wholeNone.slice(), 0, 0.5), "|", store(wholeOne.slice(), 1, 0.5));
  console.log(store(wholeOne.slice(), 0, 0.5), "|", store(wholeTwo.slice(), 2, 0.5));
  console.log(store(wholeThree.slice(), 0, 0.5), "|", store(wholeFour.slice(), 4, 0.5));
  console.log(store(wholeEight.slice(), 7, 0.5), "|", store(wholeNine.slice(), 0, 0.5));
  console.log(store(wholeBehindAHole.slice(), 1, 0.5), "|", store(wholeBeforeAHole.slice(), 0, 0.5));
  console.log(store(wholeBetweenHoles.slice(), 3, 0.5), "|", store(wholeAndLong.slice(), 69, 0.5));
  for (let from = -11; from <= 11; from++) {
    console.log(from, store(wholeBetweenHoles.slice(from), 12, 0.5), "|", store(wholeNine.slice(from), 0, 0.5));
    for (let to = -11; to <= 11; to += 3) {
      console.log(from, to, store(wholeBetweenHoles.slice(from, to), 0, 0.5));
      console.log(from, to, store(wholeNine.slice(from, to), 1, 0.5));
    }
  }
  console.log(store(wholeAndLong.slice(3, 67), 0, 0.5), "|", store(wholeAndLong.slice(3, 68), 0, 0.5));
}
console.log(show(wholeNone), show(wholeOne), show(wholeTwo), show(wholeThree), show(wholeFour), show(wholeEight));
console.log(show(wholeNine), show(wholeBehindAHole), show(wholeBeforeAHole), show(wholeBetweenHoles));
