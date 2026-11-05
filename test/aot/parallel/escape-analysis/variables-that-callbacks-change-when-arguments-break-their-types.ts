// `let sum = 0; map.forEach((value, key) => { sum += key + value; })`: the callback is inlined behind tests of its declared parameter types.
// A value of another type takes the unlikely path, where the callback is called. The variable has the same value after either path.
function sumOfMap(map: Map<number, number>): unknown {
  let sum = 0;
  map.forEach((value, key) => {
    sum += key + value;
  });
  return sum;
}
function sumAndCount(map: Map<number, number>): string {
  let sum = 0,
    count = 0;
  const step = 2;
  map.forEach((value, key) => {
    sum += key + value;
    count += step;
  });
  return sum + "/" + count;
}
function sumOfSet(set: Set<number>): unknown {
  let sum = 1;
  set.forEach(value => {
    sum += value;
  });
  return sum;
}
function sumOfList(list: number[]): unknown {
  let sum = 0.5;
  list.forEach((value, index) => {
    sum += value * index;
  });
  return sum;
}
function sumUntilThrow(map: Map<number, number>): string {
  let sum = 0,
    seen = 0;
  try {
    map.forEach(value => {
      seen++;
      sum += value;
    });
  } catch (error) {
    return sum + "/" + seen + "/" + (error as Error).constructor.name;
  }
  return sum + "/" + seen;
}
function nested(maps: Map<number, number>[]): string {
  let outer = 0,
    walks = 0;
  maps.forEach(map => {
    let inner = 0;
    map.forEach((value, key) => {
      inner += value - key;
      walks++;
    });
    outer += inner;
  });
  return outer + "/" + walks;
}
function lastOfEach(map: Map<number, number>): string {
  let last = -1,
    lastKey = -1;
  map.forEach((value, key) => {
    last = value;
    lastKey = key;
  });
  return typeof last + ":" + String(last) + "@" + String(lastKey);
}

const pairs = (values: unknown[]): Map<number, number> =>
  new Map(values.map((value, index) => [index, value])) as Map<number, number>;
const numbers = pairs([3, 1, 4, 1, 5, 9, 2, 6]);
const fractions = pairs([0.5, 1.25, -3.75]);
const kinds: Map<number, number>[] = [
  numbers,
  fractions,
  pairs([1, "two", 3]),
  pairs(["first", 2, 3]),
  pairs([1, 2, undefined]),
  pairs([1, null, 3]),
  pairs([1, true, 3]),
  pairs([1, { valueOf: () => 40 }, 3]),
  pairs([1, [7], 3]),
  pairs([NaN, 1, -0]),
  pairs([]),
  new Map([["key", 1]] as unknown as [number, number][]),
  new Map([[{ toString: () => "object" }, 1]] as unknown as [number, number][]),
];
const throwing: Map<number, number>[] = [
  pairs([1, 2n, 3]),
  pairs([1, Symbol.iterator, 3]),
  pairs([
    1,
    {
      valueOf: () => {
        throw new RangeError("no");
      },
    },
    3,
  ]),
];

const lines: string[] = [];
let check = 0;
for (let round = 0; round < 3000; round++) {
  check +=
    (sumOfMap(numbers) as number) + (sumOfMap(fractions) as number) + (sumOfSet(new Set(numbers.values())) as number);
  const kind = kinds[round % kinds.length]!;
  const line = [
    String(sumOfMap(kind)),
    sumAndCount(kind),
    String(sumOfSet(new Set(kind.values()))),
    String(sumOfList([...kind.values()])),
    sumUntilThrow(throwing[round % throwing.length]!),
    sumUntilThrow(kind),
    nested([numbers, kind, fractions]),
    lastOfEach(kind),
  ].join(" | ");
  if (round < kinds.length * 3 || round % 977 === 0) lines.push(line);
}
console.log(check);
console.log(lines.join("\n"));
