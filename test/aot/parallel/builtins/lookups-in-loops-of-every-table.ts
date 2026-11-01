// Lookups in loops whose table is read once, for tables of every size and origin: copies of a key,
// tables that change between and during the loops, tables written in the program, and receivers behind tests.
export {};

const lines: string[] = [];
function report(name: string, ...values: unknown[]) {
  lines.push(name + ": " + values.map(value => JSON.stringify(value)).join(" "));
}
function copyOf(text: string): string {
  return text.split("").join("");
}

function sumOfStrings(map: Map<string, number>, keys: string[]): number {
  let sum = 0;
  for (let i = 0; i < keys.length; i++) sum += map.get(keys[i]!) ?? -1;
  return sum;
}
function countOfStrings(set: Set<string>, keys: string[]): number {
  let count = 0;
  for (let i = 0; i < keys.length; i++) if (set.has(keys[i]!)) count++;
  return count;
}
function hasStrings(map: Map<string, number>, keys: string[]): number {
  let count = 0;
  for (let i = 0; i < keys.length; i++) if (map.has(keys[i]!)) count++;
  return count;
}
function sumOfNumbers(map: Map<number, number>, keys: number[]): number {
  let sum = 0;
  for (let i = 0; i < keys.length; i++) sum += map.get(keys[i]!) ?? -1;
  return sum;
}
function countOfNumbers(set: Set<number>, keys: number[]): number {
  let count = 0;
  for (let i = 0; i < keys.length; i++) if (set.has(keys[i]!)) count++;
  return count;
}

for (const size of [0, 1, 7, 8, 9, 16, 64, 190, 254, 255, 1000, 5000]) {
  const names: string[] = [];
  const numbers: number[] = [];
  for (let i = 0; i < size; i++) {
    names.push("key" + i);
    numbers.push(i * 7);
  }
  const strings = new Map<string, number>();
  const setOfStrings = new Set<string>();
  const byNumber = new Map<number, number>();
  const setOfNumbers = new Set<number>();
  for (let i = 0; i < size; i++) {
    strings.set(names[i]!, i);
    setOfStrings.add(names[i]!);
    byNumber.set(numbers[i]!, i);
    setOfNumbers.add(numbers[i]!);
  }
  const copies = names.map(copyOf);
  for (const copy of copies) strings.has(copy);
  const missing = names.map(name => name + "!");
  const otherNumbers = numbers.map(number => number + 1);
  report("hits " + size, sumOfStrings(strings, names), countOfStrings(setOfStrings, names), hasStrings(strings, names), sumOfNumbers(byNumber, numbers), countOfNumbers(setOfNumbers, numbers));
  report("copies " + size, sumOfStrings(strings, copies), countOfStrings(setOfStrings, copies), hasStrings(strings, copies));
  report("misses " + size, sumOfStrings(strings, missing), countOfStrings(setOfStrings, missing), hasStrings(strings, missing), sumOfNumbers(byNumber, otherNumbers), countOfNumbers(setOfNumbers, otherNumbers));

  for (let i = 0; i < size; i += 3) {
    strings.delete(names[i]!);
    setOfStrings.delete(names[i]!);
    byNumber.delete(numbers[i]!);
    setOfNumbers.delete(numbers[i]!);
  }
  report("deleted " + size, sumOfStrings(strings, names), countOfStrings(setOfStrings, copies), sumOfNumbers(byNumber, numbers), countOfNumbers(setOfNumbers, numbers));
  for (let i = 0; i < size; i += 6) {
    strings.set(copies[i]!, i + 1);
    byNumber.set(numbers[i]!, i + 1);
  }
  report("added again " + size, sumOfStrings(strings, names), sumOfNumbers(byNumber, numbers), [...strings.keys()].slice(-2));
  strings.clear();
  setOfNumbers.clear();
  report("cleared " + size, sumOfStrings(strings, names), countOfNumbers(setOfNumbers, numbers));
}

const doubles = new Map<number, string>([[0, "zero"], [1.5, "half"], [NaN, "nan"], [2 ** 40, "large"], [-1, "minus"]]);
for (let i = 0; i < 20; i++) doubles.set(i * 1000, "n" + i);
const lookedUp: (string | undefined)[] = [];
for (const key of [-0, 0, 1.5, NaN, 2 ** 40, -1, 1, 1000, 1000.5, 19000, Infinity]) lookedUp.push(doubles.get(key));
report("doubles", lookedUp);
function namesOfDoubles(keys: number[]): (string | undefined)[] {
  const answers: (string | undefined)[] = [];
  for (let i = 0; i < keys.length; i++) answers.push(doubles.get(keys[i]!));
  return answers;
}
report("doubles in a loop", namesOfDoubles([-0, 0, 1.5, NaN, 2 ** 40, -1, 1, 1000, 1000.5, 19000, Infinity]));

const written = new Map<string, number>([["red", 1], ["green", 2], ["blue", 3], ["cyan", 4], ["pink", 5], ["gray", 6]]);
const writtenLarge = new Map<string, number>(Array.from({ length: 40 }, (_, i) => ["word" + i, i] as [string, number]));
const writtenSet = new Set<string>(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"]);
const colors = ["gold", "red", "green", copyOf("blue"), "cyan", "teal", "pink", "gray"];
report("written", sumOfStrings(written, colors), sumOfStrings(written, colors), [...written.keys()]);
function sizesWhileLooking(map: Map<string, number>, keys: string[]): number[] {
  const seen: number[] = [];
  for (let i = 0; i < keys.length; i++) {
    seen.push(map.size);
    seen.push(map.get(keys[i]!) ?? -1);
  }
  return seen;
}
report("size between lookups", sizesWhileLooking(new Map<string, number>([["red", 1], ["blue", 2], ["pink", 3]]), colors));
report("written large", sumOfStrings(writtenLarge, ["word3", copyOf("word39"), "word40"]), countOfStrings(writtenSet, ["a", copyOf("l"), "m"]));

function growWhileLooking(map: Map<number, number>, turns: number): number {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    sum += map.get(i >> 1) ?? 1000;
    if (i % 3 === 0) map.set(i, i);
  }
  return sum;
}
report("grows in the loop", growWhileLooking(new Map<number, number>(), 3000));
function changeBehindACall(map: Map<number, number>, change: (i: number) => void, turns: number): number {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    sum += map.get(i) ?? 1000;
    change(i);
  }
  return sum;
}
const changing = new Map<number, number>();
report("changes behind a call", changeBehindACall(changing, i => { changing.set(i + 1, i); if (i % 5 === 0) changing.delete(i); }, 2000), changing.size);

function behindATest(map: Map<number, number> | undefined, keys: number[]): number {
  let sum = 0;
  for (let i = 0; i < keys.length; i++) {
    if (i % 2 === 0 && map) sum += map.get(keys[i]!) ?? 1;
  }
  return sum;
}
report("behind a test", behindATest(undefined, [1, 2, 3]), behindATest(new Map([[0, 5], [2, 7]]), [0, 1, 2]));
function oddReceivers(map: any, keys: string[]): unknown {
  try {
    let sum = 0;
    for (let i = 0; i < keys.length; i++) sum += (map as Map<string, number>).get(keys[i]!) ?? 1;
    return sum;
  } catch (error) {
    return (error as Error).name;
  }
}
class Counting extends Map<string, number> {
  override get(key: string): number | undefined {
    return (super.get(key) ?? 0) + 100;
  }
}
report("odd receivers", oddReceivers(null, ["a"]), oddReceivers({ get: () => 5 }, ["a", "b"]), oddReceivers(new Counting([["a", 1]]), ["a", "b"]));

console.log(lines.join("\n"));
