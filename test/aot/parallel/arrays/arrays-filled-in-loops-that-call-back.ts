// `result = []; for (i = 0; i < array.length; i++) result.push(f(array[i], i))`: the literal may be made with room for array.length elements.
// That is a prediction and nobody can tell: not where the callback changes the array that is walked, not where the array is null, not where the loop is left early.
const lines: string[] = [];
function say(...values: unknown[]) {
  lines.push(values.map(String).join(" "));
}

// A compiled program does not quote the expression.
function withoutSourceText(error: unknown) {
  return (error as Error).message.split(" (evaluating")[0];
}

function map<T, U>(array: readonly T[] | undefined, f: (x: T, i: number) => U): U[] | undefined {
  let result: U[] | undefined;
  if (array !== undefined) {
    result = [];
    for (let i = 0; i < array.length; i++) {
      result.push(f(array[i], i));
    }
  }
  return result;
}
function mapBackwards<T, U>(array: readonly T[], f: (x: T) => U): U[] {
  const result: U[] = [];
  for (let i = array.length - 1; i >= 0; i--) result.push(f(array[i]));
  return result;
}
function mapInTry<T, U>(array: readonly T[], f: (x: T) => U): U[] | string {
  try {
    const result: U[] = [];
    for (let i = 0; i < array.length; i++) result.push(f(array[i]));
    return result;
  } catch (error) {
    return "caught " + withoutSourceText(error);
  }
}
let sideEffects = 0;
function mapAfterACall<T, U>(array: readonly T[], f: (x: T) => U): U[] {
  const result: U[] = [];
  sideEffects++;
  for (let i = 0; i < array.length; i++) result.push(f(array[i]));
  return result;
}
function mapUntil<T, U>(array: readonly T[], f: (x: T) => U, stop: U): U[] {
  const result: U[] = [];
  for (let i = 0; i < array.length; i++) {
    const mapped = f(array[i]);
    result.push(mapped);
    if (mapped === stop) break;
  }
  return result;
}
function mapOfMap<K, V, U>(entries: Map<K, V>, f: (value: V, key: K) => U): U[] {
  const result: U[] = [];
  for (const [key, value] of entries) result.push(f(value, key));
  return result;
}
function range(length: number): number[] {
  const numbers: number[] = [];
  for (let i = 0; i < length; i++) numbers.push(i);
  return numbers;
}
function sum(numbers: readonly number[] | undefined) {
  let total = 0;
  if (numbers) for (const number of numbers) total += number;
  return total;
}

for (let round = 0; round < 3; round++) {
  for (const length of [0, 1, 2, 3, 4, 7, 8, 25, 26, 100, 5000, 70000]) {
    const mapped = map(range(length), (x, i) => x * 2 + i + round);
    say("map", length, mapped!.length, sum(mapped), mapBackwards(range(length), x => x + round).length);
  }
  say("undefined", map(undefined, x => x));

  const growing = [1, 2, 3];
  say("grows", map(growing, x => { if (growing.length < 9) growing.push(x + 10); return x; }), growing.length);
  const shrinking = range(12);
  say("shrinks", map(shrinking, x => { shrinking.pop(); return x; }), shrinking.length);
  const emptied = range(6);
  say("emptied", map(emptied, x => { emptied.length = 0; return x; }), emptied.length);
  const holes = [1, , 3, , 5] as number[];
  say("holes", map(holes, x => x === undefined ? "hole" : x));
  const appendedTo: number[] = [];
  const results = map(range(5), x => { appendedTo.push(x); return appendedTo; });
  say("same", results!.every(result => result === appendedTo), appendedTo);

  try {
    say("null", map(null as unknown as number[], x => x));
  } catch (error) {
    say("null throws", (error as Error).constructor.name, withoutSourceText(error));
  }
  try {
    say(mapAfterACall(null as unknown as number[], x => x));
  } catch (error) {
    say("after a call", sideEffects, (error as Error).constructor.name);
  }
  say("in try", mapInTry(null as unknown as number[], x => x));
  say("in try", mapInTry(range(4), x => { if (x === 2 + round) throw new Error("at " + x); return x; }));
  say("until", mapUntil(range(1000), x => x * 3, 27 + round * 3));
  say("of a map", mapOfMap(new Map(range(9).map(x => [x, x * x] as [number, number])), (value, key) => value - key + round));
  const walked = new Map<number, number>([[1, 1]]);
  say("of a map that grows", mapOfMap(walked, (value, key) => { if (key < 6) walked.set(key + 1, value * 2); return value; }), walked.size);
  const strings = map(["a", "b", "c"], (x, i) => x.repeat(i + 1));
  strings!.push("pushed later");
  strings!.length = 3 + round % 2;
  say("later", strings);
}
console.log(lines.join("\n"));
