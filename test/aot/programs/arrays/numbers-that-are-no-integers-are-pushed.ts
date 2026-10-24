// A number that compiled code holds as a double is pushed onto arrays of every kind of storage, in code that runs once and in a loop.
// What is stored is the number itself, negative zero and NaN included, and an array that takes no more elements says so.
const one: number = process.argv.length > 100 ? 3 : 1;

function text(value: unknown): string {
  return Object.is(value, -0) ? "-0" : String(value);
}
function show(label: string, array: readonly unknown[]): void {
  console.log(label, array.length, array.map(text).join(" "));
}

function ontoFractions(): void {
  const array: number[] = [one * 0.5];
  const lengths: number[] = [];
  lengths.push(array.push(one * 1.5));
  lengths.push(array.push(one * 4));
  lengths.push(array.push(one * -0));
  lengths.push(array.push(one / 0));
  lengths.push(array.push(-one / 0));
  lengths.push(array.push(one * 5e-324));
  show("fractions", array);
  lengths.push(array.push((one - 1) / 0 - (one - 1) / 0));
  lengths.push(array.push(one * 2.25));
  lengths.push(array.push(one * 7));
  show("fractions and NaN", array);
  show("lengths", lengths);
}

function ontoIntegers(): void {
  const array: number[] = [one, one + 1];
  array.push(one * 0.5);
  array.push(one * 3);
  show("integers", array);
  const stillIntegers: number[] = [one, one + 1];
  stillIntegers.push(one / 1);
  stillIntegers.push(Math.sqrt(one * 16));
  show("whole numbers", stillIntegers);
}

function ontoValues(): void {
  const array: (number | string)[] = ["first"];
  array.push(one * 0.5);
  array.push(one * 2);
  array.push(one * -0);
  array.push(Math.sqrt(-one));
  show("values", array);
}

function ontoLiterals(): void {
  for (let round = 0; round < 2; round++) {
    const fractions: number[] = [0.5, 1.5, 2.5];
    fractions.push(one * 3.5);
    show("a literal of fractions", fractions);
    const integers: number[] = [1, 2, 3];
    integers.push(one * 3.5);
    show("a literal of integers", integers);
  }
}

function ontoNothing(): void {
  const array: number[] = [];
  array.push(one * 0.25);
  array.push(one * 0.75);
  show("nothing", array);
}

function untilFull(): void {
  const array: number[] = [one * 0.5];
  for (let i = 1; i < 70; i++) array.push(i * 0.5 * one);
  let sum = 0;
  for (const value of array) sum += value;
  console.log("seventy", array.length, sum, array[69]);
}

function ontoArraysThatTakeNoMore(): void {
  const ways: [string, (array: number[]) => unknown][] = [
    ["frozen", array => Object.freeze(array)],
    ["sealed", array => Object.seal(array)],
    ["not extensible", array => Object.preventExtensions(array)],
  ];
  for (const [name, close] of ways) {
    const array: number[] = [one * 0.5, one * 1.5];
    close(array);
    try {
      array.push(one * 2.5);
      console.log(name, "pushed");
    } catch (error) {
      console.log(name, error instanceof TypeError, array.length, array.join(" "));
    }
  }
}

function ontoArraysWithGaps(): void {
  const array: number[] = [one * 0.5];
  array[2000] = one * 1.5;
  array.push(one * 2.5);
  console.log("gaps", array.length, array[0], array[1], array[2000], array[2001]);
  const holes: number[] = [one * 0.5, , one * 1.5] as number[];
  holes.push(one * 2.5);
  console.log("holes", holes.length, 1 in holes, holes[3]);
}

class Samples extends Array<number> {
  mean(): number {
    let sum = 0;
    for (const value of this) sum += value;
    return sum / this.length;
  }
}
function ontoAnHeir(): void {
  const samples = new Samples();
  samples.push(one * 0.5);
  samples.push(one * 1.5);
  samples.push(one * 4);
  console.log("an heir", samples.length, samples.mean(), samples instanceof Samples);
}

ontoFractions();
ontoIntegers();
ontoValues();
ontoLiterals();
ontoNothing();
untilFull();
ontoArraysThatTakeNoMore();
ontoArraysWithGaps();
ontoAnHeir();
