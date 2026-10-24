declare const console: { log(...values: any[]): void };

const whole = Array.from({ length: 9 }, (_, k) => k);
const fractions = [0.5, 1.5, -0, 2.25, 1e300];
const holey = [1, , 3, , 5] as number[];
const texts = ["a", "", "ccc", "dd"];

function returnedChain(list: number[], by: number): number {
  return list
    .filter(value => value & 1)
    .map(value => value * by)
    .reduce((sum, value) => sum + value, 0);
}

function returnedJoin(list: number[]): string {
  return list.map(value => value + 0.5).join("|");
}

function mapped(list: number[], by: number): number[] {
  return list.map(value => value / by);
}

function kept(list: number[], limit: number): number[] {
  const some = list.filter(value => value < limit);
  return some;
}

function lengths(list: string[]): number[] {
  const counts = list.map(text => text.length);
  counts.push(0.5);
  return counts;
}

function throwsAt(list: number[], at: number): number {
  return list.map(value => value + 1).reduce((sum, value) => {
    if (value === at) throw new RangeError("at " + value);
    return sum + value;
  }, 0);
}

class Stack extends Array<number> {}

function describe(list: unknown[]): string {
  let text = list.length + ":";
  for (let index = 0; index < list.length; index++) text += index in list ? Object.is(list[index], -0) ? "-0," : list[index] + "," : "hole,";
  return text + list.constructor.name;
}

let check = 0;
for (let turn = 0; turn < 3000; turn++) {
  check += returnedChain(whole, turn & 3) + mapped(whole, 2)[turn % 9]! + kept(whole, turn % 10).length + lengths(texts)[turn & 3]!;
  check += returnedJoin(fractions).length;
}
console.log(check);
console.log(describe(mapped(whole, 0)), describe(mapped(fractions, 0)), describe(mapped(holey, 2)));
console.log(describe(kept(holey, 4)), describe(kept(fractions, 2)), describe(kept([], 1)), describe(kept([NaN, 1, NaN], 2)));
console.log(describe(lengths(texts)), returnedJoin(holey), returnedChain(holey, 0.5), returnedChain([], 1));
const stack = Stack.from([3, 1, 2]) as Stack;
console.log(describe(mapped(stack, 2)), describe(kept(stack, 3)), returnedChain(stack, 2));
for (const at of [2, 100]) {
  try {
    console.log(throwsAt(whole, at));
  } catch (error) {
    console.log((error as Error).name, (error as Error).message);
  }
}
const growing = [1, 2, 3];
console.log(describe(growing.map(value => (growing.length < 6 && growing.push(value * 10), value + 0.25))), describe(growing));
const shrinking = [1, 2, 3, 4];
console.log(describe(shrinking.filter(value => (shrinking.pop(), value > 0))), describe(shrinking));
