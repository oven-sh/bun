// Each operator takes a value that an array of numbers, booleans or strings, or an iterator of numbers, hands out: in bounds, from a hole, past the end, and from an iterator that has ended.
const numbers: number[] = [1, 2.5, 3, 4, -0, 2147483647];
const flags: boolean[] = [true, true, false];
const words: string[] = ["a", "b", "c"];
delete numbers[2];
delete flags[1];
delete words[1];
function* upTo(limit: number): Generator<number> {
  for (let value = 0; value < limit; value++) yield value;
}
function sumByIndex(list: number[], length: number): number {
  let sum = 0;
  for (let index = 0; index < length; index++) sum += list[index]!;
  return sum;
}
function sumByIteration(list: number[]): number {
  let sum = 0;
  for (const value of list) sum += value;
  return sum;
}
function each(index: number): unknown[] {
  return [
    1 + numbers[index]!,
    numbers[index]! - 1,
    numbers[index]! * 2,
    7 / numbers[index]!,
    numbers[index]! % 3,
    numbers[index]! ** 2,
    -numbers[index]!,
    +numbers[index]!,
    ~numbers[index]!,
    numbers[index]! | 0,
    numbers[index]! & 6,
    numbers[index]! ^ 1,
    numbers[index]! << 1,
    numbers[index]! >> 1,
    numbers[index]! >>> 1,
    numbers[index]! < 3,
    3 <= numbers[index]!,
    numbers[index]! === 4,
    numbers[index]! == 4,
    numbers[index]! !== undefined,
    !numbers[index]!,
    typeof numbers[index]!,
    `${numbers[index]!}`,
    "n" + numbers[index]!,
    flags[index]! ? "yes" : "no",
    !flags[index]!,
    flags[index]! && index,
    flags[index]! === false,
    words[index]! + "!",
    words[index]! < "b",
    words[index]! === "c",
    typeof words[index]!,
  ];
}
function firstTwo(limit: number): number {
  const [first, second] = upTo(limit);
  return first! + second!;
}
function swapped(list: number[], from: number, to: number): number {
  [list[from], list[to]] = [list[to]!, list[from]!];
  return list[from]! - list[to]!;
}
for (let round = 0; round < 3; round++) {
  for (let index = -1; index < 8; index++) console.log(round, index, JSON.stringify(each(index)), Object.is(-numbers[index]!, 0));
  console.log(sumByIndex(numbers, 2), sumByIndex(numbers, 3), sumByIndex(numbers, 9), sumByIndex([1, 2, 3], 3), sumByIteration(numbers), sumByIteration([4, 5]));
  console.log(firstTwo(0), firstTwo(1), firstTwo(2), firstTwo(5), swapped([1, 2, 3], 0, 2), swapped([1, 2, 3], 0, 7));
  let total = 0;
  for (const value of upTo(1000)) total += value;
  console.log(total, [...numbers, round, ...[7, 8]][6]! + [...numbers, round, ...[7, 8]][11]!);
}
