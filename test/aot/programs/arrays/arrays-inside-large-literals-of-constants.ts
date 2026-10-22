// A literal of more than sixteen constants is made out of a record. Each array in it is an array of its own, begins with storage that fits what the program goes on to put into it,
// and takes any other value all the same.
type State = {
  a0: number; a1: number; a2: number; a3: number; a4: number; a5: number; a6: number; a7: number;
  a8: number; a9: number; a10: number; a11: number; a12: number; a13: number; a14: number; a15: number;
  texts: string[]; points: { x: number }[]; numbers: number[]; either: (number | string)[]; anything: any[]; never: boolean[];
  whole: number[]; fractions: number[]; wholeOrText: (number | string)[]; holes: (number | undefined)[]; odd: number[]; nested: number[][];
};
function make(): State {
  return {
    a0: 0, a1: 0, a2: 0, a3: 0, a4: 0, a5: 0, a6: 0, a7: 0, a8: 0, a9: 0, a10: 0, a11: 0, a12: 0, a13: 0, a14: 0, a15: 0,
    texts: [], points: [], numbers: [], either: [], anything: [], never: [],
    whole: [1, 2, 3], fractions: [0.5, 1.5], wholeOrText: [4, 5, 6], holes: [1, , 3], odd: [0, -0, NaN, 2147483648, -2147483649, 1e300], nested: [[], [7], []],
  };
}
function makeUntyped(): any {
  return {
    a0: 0, a1: 0, a2: 0, a3: 0, a4: 0, a5: 0, a6: 0, a7: 0, a8: 0, a9: 0, a10: 0, a11: 0, a12: 0, a13: 0, a14: 0, a15: 0,
    first: [], second: [], third: [], whole: [1, 2, 3],
  };
}
const show = (value: unknown) => JSON.stringify(value, (_, each) => (Object.is(each, -0) ? "-0" : typeof each === "number" && !Number.isFinite(each) ? String(each) : each));

// Every evaluation has arrays of its own.
const one = make(), two = make();
one.texts.push("a"); one.points.push({ x: 1 }); one.numbers.push(1.5); one.either.push(1); one.anything.push(null); one.whole[0] = 9; one.wholeOrText[1] = "five"; one.nested[0].push(1);
console.log(show(one));
console.log(show(two));
console.log(show(make()));
console.log(one.texts === two.texts, one.whole === two.whole, one.nested[0] === one.nested[2], one.nested[0] === two.nested[0]);

// What the type does not say goes in too.
const wrong = make() as any;
wrong.texts.push(1, 2.5, { x: 1 }, undefined); wrong.points.push("p", 3); wrong.numbers.push("n", 1, NaN, -0); wrong.either.push({}, 0.5); wrong.never.push(1, "x");
wrong.whole.push("w"); wrong.fractions.push("f", 1); wrong.whole[1] = 2.5; wrong.fractions[0] = null;
console.log(show(wrong));

// Whole numbers first, then the rest, into each of the empty ones.
for (const key of ["texts", "points", "numbers", "either", "anything", "never"] as const) {
  const list = (make() as any)[key];
  const lengths = [list.push(1), list.push(2, 3, 4, 5, 6, 7), list.push(0.5), list.push("t"), list.unshift({ k: key })];
  list[12] = true;
  console.log(key, show(lengths), list.length, 10 in list, show(list));
}

// Stores by index, lengths, holes.
const stored = make();
stored.texts[0] = "zero"; stored.texts[2] = "two"; stored.numbers[0] = 1; stored.numbers[1] = 0.25; stored.points.length = 2; stored.either[3] = "three"; stored.never.length = 0;
console.log(show(stored.texts), 1 in stored.texts, show(stored.numbers), stored.points.length, 0 in stored.points, show(stored.either), stored.never.length);
console.log(1 in stored.holes, stored.holes.length, stored.holes[1], Object.keys(stored.holes).join());
console.log(Object.is(stored.odd[1], -0), Number.isNaN(stored.odd[2]), stored.odd[3] + 1, stored.odd[4] - 1, stored.odd.indexOf(NaN), stored.odd.includes(NaN));

// Methods that read, copy and write in place.
const used = make();
console.log(show([...used.texts, ...used.whole, ...used.wholeOrText]), show((used.texts as (number | string)[]).concat(used.whole, ["c"])), show(used.whole.slice().reverse()), show(used.whole), show(used.wholeOrText.map(each => typeof each)));
used.whole.reverse(); used.wholeOrText.fill("z", 1, 2); used.fractions.sort((a, b) => b - a); used.texts.splice(0, 0, "s", "t"); used.numbers.splice(0, 0, 1, 2);
console.log(show(used.whole), show(used.wholeOrText), show(used.fractions), show(used.texts), show(used.numbers), show(make().whole), show(make().wholeOrText));
console.log(Array.isArray(used.never), used.never.pop(), used.never.shift(), used.never.join("-") === "", used.never.at(0), used.never.indexOf(true), show(used.never.flat()));

// Frozen and sealed.
const frozen = make();
Object.freeze(frozen.texts); Object.freeze(frozen.whole); Object.seal(frozen.numbers);
for (const attempt of [() => frozen.texts.push("x"), () => { "use strict"; frozen.whole[0] = 5; }, () => frozen.numbers.push(1)]) {
  try { attempt(); console.log("stored"); } catch (error) { console.log((error as Error).constructor.name); }
}
console.log(show(frozen.texts), show(frozen.whole), show(frozen.numbers), show(make().texts), show(make().whole));

// Untyped, each list with its own kind of value.
let sum = 0;
for (let round = 0; round < 3000; round++) {
  const bag = makeUntyped();
  bag.first.push(round); bag.second.push("s" + (round & 3)); bag.third.push(round + 0.5, round);
  bag.whole[round % 3] += round;
  sum += bag.first[0] + bag.second[0].length + bag.third[0] + bag.third[1] + bag.whole[0] + bag.whole[1] + bag.whole[2];
}
console.log(sum);

// A record that is lowered twice: the statements of `finally`.
function twice(fail: boolean): number[] {
  let table: number[] = [];
  try {
    if (fail) throw new Error("no");
  } catch {
  } finally {
    table = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
    if (fail) table[0] = 0.5;
  }
  return table;
}
console.log(show(twice(false)), show(twice(true)), show(twice(false)));

// Tables at the top level, read often, written once.
const days: number[] = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365, 396, 424, 455, 485, 516, 546, 577];
const codes: (number | string)[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
const ratios: (number | string)[] = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5];
function total(list: (number | string)[]): number { let result = 0; for (const each of list) if (typeof each === "number") result += each; return result; }
let read = 0;
for (let round = 0; round < 5000; round++) read += days[round % 20] + total(codes) + total(ratios);
codes[3] = "four"; ratios[16] = "last"; days[19] = 0.5;
for (let round = 0; round < 5000; round++) read += days[round % 20] + total(codes) + total(ratios);
console.log(read, show(codes), show(ratios), show(days));

// Across collections.
const survivors: State[] = [];
for (let round = 0; round < 40000; round++) {
  const state = make();
  state.texts.push("t" + (round & 7)); state.numbers.push(round); state.points.push({ x: round }); state.nested[2].push(round);
  if (round % 4000 === 0) { survivors.push(state); Bun.gc(true); }
}
console.log(show(survivors.map(each => [each.texts, each.numbers, each.points, each.nested, each.whole, each.never])));
