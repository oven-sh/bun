// Arrays of holes, literals with holes, rest arrays and copies of typed arrays made in code that runs once or a few times: lengths on both sides of what the allocation stub takes, and free lists that run out.
const out: string[] = [];

function describe(list: readonly unknown[]): string {
  let present = 0;
  let sum = 0;
  for (let i = 0; i < list.length; i++) {
    if (!(i in list)) continue;
    present++;
    if (typeof list[i] === "number") sum += list[i] as number;
  }
  return list.length + "/" + present + "/" + sum;
}

function collect(first: unknown, ...rest: unknown[]): unknown[] {
  return rest;
}

function collectAll(...all: number[]): number[] {
  return all;
}

function numbersUpTo(count: number): number[] {
  const numbers: number[] = [];
  for (let i = 0; i < count; i++) numbers.push(i + 1);
  return numbers;
}

function ofLength(length: number): unknown[] {
  return new Array(length);
}

function withHoles(first: unknown, last: unknown): unknown[] {
  return [first, , , last, ,];
}

const lengths = [0, 1, 2, 3, 4, 5, 6, 7, 8, 125, 126, 127, 128, 129, 254, 255, 256, 257, 300, 1000];

function checkEverything(label: string): void {
  for (const length of lengths) {
    const holes = ofLength(length);
    out.push(label + " holes " + length + " " + describe(holes));
    holes.push(length);
    holes[length + 2] = 1;
    out.push(label + " holes grown " + length + " " + describe(holes));

    const numbers = numbersUpTo(length);
    const rest = collect("first", ...numbers);
    out.push(label + " rest " + length + " " + describe(rest));
    rest.push(7);
    out.push(label + " rest grown " + length + " " + describe(rest));
    out.push(label + " all " + length + " " + describe(collectAll(...numbers)));

    out.push(label + " bytes " + length + " " + describe(Array.from(new Uint8Array(numbers))));
    out.push(label + " floats " + length + " " + describe(Array.from(new Float64Array(numbers))));
  }
  out.push(label + " none " + describe(collect("first")) + " " + describe(collect(undefined)) + " " + describe((collect as () => unknown[])()));
  out.push(label + " literal " + describe(withHoles(1, 2)) + " " + describe(withHoles("a", undefined)));
  for (const bad of [-1, 1.5, 2 ** 32, NaN]) {
    try {
      out.push(label + " bad length " + bad + " " + describe(ofLength(bad)));
    } catch (error) {
      out.push(label + " bad length " + bad + " " + (error as Error).name);
    }
  }
}

checkEverything("first");

const kept: unknown[][] = [];
for (let round = 0; round < 3000; round++) {
  const length = lengths[round % 12];
  kept[round % 64] = round & 1 ? ofLength(length) : collect(round, round, round + 1, round + 2);
}
let total = 0;
for (const list of kept) total += list.length;
out.push("kept " + total);

checkEverything("again");

console.log(out.join("\n"));
