// Each array is read and written by the same functions, whoever created it: a literal, `new Array(n)`, a method of the library, native code, a species.
function sum(list: number[]): number {
  let total = 0;
  for (let index = 0; index < list.length; ++index) total += list[index];
  return total;
}
function describe(list: unknown[]): string {
  let text = "";
  for (let index = 0; index < list.length; ++index) text += (index in list ? typeof list[index] + ":" + String(list[index]) : "hole") + " ";
  return `${list.length} [${text.trim()}] ${Object.getPrototypeOf(list) === Array.prototype ? "plain" : list.constructor.name}`;
}
function integers(count: number): number[] {
  const list: number[] = [];
  for (let index = 0; index < count; ++index) list.push((index * 7) & 31);
  return list;
}
function storedInto(count: number): number[] {
  const list = new Array<number>(count);
  for (let index = 0; index < count; ++index) list[index] = index & 7;
  return list;
}
function halfStored(count: number): number[] {
  const list = new Array<number>(count);
  for (let index = 0; index < count; index += 2) list[index] = index;
  return list;
}

const source = integers(9);
const created: [string, number[]][] = [
  ["pushed", source],
  ["stored", storedInto(9)],
  ["called", Array<number>(3)],
  ["mapped to integers", source.map((value: number): number => (value + 1) | 0)],
  ["mapped to fractions", source.map((value: number): number => value / 4)],
  ["filtered", source.filter((value: number): boolean => value > 10)],
  ["from a length", Array.from({ length: 5 }, (_: unknown, index: number): number => index * index)],
  ["from an array", Array.from(source)],
  ["sliced", source.slice(2, 6)],
  ["concatenated", source.concat([0.5], storedInto(2))],
  ["flat mapped", source.flatMap((value: number): number[] => (value & 1 ? [value, -value] : []))],
  ["spread", [...source.keys()]],
  ["of", Array.of(3, 2, 1)],
];
for (const [name, list] of created) console.log(name, sum(list), describe(list));
console.log("half stored", sum(halfStored(6)), describe(halfStored(6)));

// What is stored later changes the storage, and every reader still sees the values.
for (const [name, list] of created) {
  const loose = list as unknown[];
  loose[1] = 0.25;
  console.log(name, "with a fraction", sum(list), describe(list));
  loose[0] = "text";
  loose.push(undefined, null);
  console.log(name, "with a text", describe(list));
  loose.length = 2;
  loose[4] = { toString: () => "object" };
  console.log(name, "with a hole", describe(list));
}

// The species decides what the methods of the library create.
class Listing extends Array<number> {}
class Plainly extends Array<number> {
  static get [Symbol.species](): ArrayConstructor {
    return Array;
  }
}
class Counted extends Array<number> {
  static made = 0;
  constructor(...items: number[]) {
    super(...items);
    Counted.made++;
  }
}
function fill<T extends number[]>(list: T): T {
  list.push(4, 5, 6);
  return list;
}
console.log(describe(fill(new Listing()).map((value: number): number => value * 2)));
console.log(describe(fill(new Plainly()).map((value: number): number => value * 2)));
console.log(describe(fill(new Counted()).filter((value: number): boolean => value > 4)), Counted.made);

const withOwnConstructor: number[] = [1, 2, 3];
(withOwnConstructor as unknown as { constructor: unknown }).constructor = { [Symbol.species]: Listing };
console.log(describe(withOwnConstructor.map((value: number): number => value + 1)));
const withoutSpecies: number[] = [1, 2, 3];
(withoutSpecies as unknown as { constructor: unknown }).constructor = { [Symbol.species]: null };
console.log(describe(withoutSpecies.map((value: number): number => value + 1)));
const withArrayForSpecies: number[] = [1, 2, 3];
(withArrayForSpecies as unknown as { constructor: unknown }).constructor = { [Symbol.species]: Array };
console.log(describe(withArrayForSpecies.map((value: number): number => value + 1)));
const withObjectForSpecies: number[] = [1, 2];
(withObjectForSpecies as unknown as { constructor: unknown }).constructor = {
  [Symbol.species]: function (this: { made: string }, length: number) {
    this.made = "with " + length;
  },
};
console.log(JSON.stringify(withObjectForSpecies.map((value: number): number => value + 1)));
try {
  const withBadSpecies: number[] = [1];
  (withBadSpecies as unknown as { constructor: unknown }).constructor = { [Symbol.species]: 1 };
  console.log(describe(withBadSpecies.map((value: number): number => value)));
} catch (error) {
  console.log((error as Error).constructor.name);
}
console.log(describe(Array.prototype.map.call({ length: 3, 0: "a", 2: "c" }, (value: unknown): string => value + "!")));
console.log(describe(Array.prototype.filter.call("text", (value: unknown): boolean => value !== "e")));

for (const length of [-1, 1.5, 4294967296, NaN]) {
  try {
    console.log(new Array<number>(length).length);
  } catch (error) {
    console.log(length, (error as Error).constructor.name);
  }
}
console.log(describe(new Array<unknown>("3")), describe(new Array<unknown>(2, 3)), describe(new Array<unknown>(0)));

// A sort puts what is undefined behind the values and the holes behind that, and the array is as plain as before.
const unsorted: (number | undefined)[] = [5, undefined, 3, , 9, undefined, 1];
console.log(describe(unsorted.sort((left, right) => (left as number) - (right as number))), describe(unsorted.slice(1)));
const onlyUndefined: undefined[] = [undefined, , undefined];
console.log(describe(onlyUndefined.sort(() => 0)));
const shrinking: (number | undefined)[] = [4, undefined, 2, undefined, 3];
console.log(
  describe(
    shrinking.sort((left, right) => {
      shrinking.length = 2;
      return (left as number) - (right as number);
    }),
  ),
);
console.log(describe(integers(9).sort((left: number, right: number): number => right - left).slice(2, 5)));
