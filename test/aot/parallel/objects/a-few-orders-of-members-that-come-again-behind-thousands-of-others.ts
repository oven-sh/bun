// A type whose objects were written in more orders than a layout numbers, and then a few orders that come again and again: written by key, deleted and written again, deleted.
// The first object of each order walks the numbered orders and searches the held ones. The objects behind it take the same steps without either.
// COUNT: counter:KeyOrdersStoredOutOfLine <= 30000
// COUNT: counter:CompiledStructuresMade <= 12000
type Ten = { a?: number; b?: number; c?: number; d?: number; e?: number; f?: number; g?: number; h?: number; i?: number; j?: number };
type Name = keyof Ten;
const letters: Name[] = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
function order(number: number): Name[] {
  const left = [...letters];
  const out: Name[] = [];
  for (let size = left.length; size > 0; size--) {
    out.push(left.splice(number % size, 1)[0]);
    number = Math.floor(number / size);
  }
  return out;
}
const full = (): Ten => ({ a: 0, b: 1, c: 2, d: 3, e: 4, f: 5, g: 6, h: 7, i: 8, j: 9 });
function madeIn(names: Name[]): Ten {
  const made: Ten = {};
  for (const name of names) made[name] = 1;
  return made;
}
function again(names: Name[]): Ten {
  const made = full();
  for (const name of names) {
    delete made[name];
    made[name] = 1;
  }
  return made;
}
function without(names: Name[]): Ten {
  const made = full();
  for (const name of names) delete made[name];
  return made;
}
const fill = Array.from({ length: 6000 }, (_, at) => madeIn(order(at * 7)));
const patterns = Array.from({ length: 50 }, (_, at) => order(1000003 + at * 977));
const n = 20000;
let wrong = 0;
function hold(made: Ten, keys: string): void {
  if (Object.keys(made).join("") !== keys) wrong++;
}
for (let at = 0; at < n; at++) {
  const names = patterns[at % 50];
  hold(madeIn(names), names.join(""));
  hold(again(names), names.join(""));
  const few = names.slice(0, 4);
  hold(without(few), letters.filter(letter => !few.includes(letter)).join(""));
}
console.log(fill.length, wrong, JSON.stringify([madeIn(patterns[7]), again(patterns[8]), without(patterns[9].slice(0, 4))]));
// An object that leaves a step half way, and one that is changed in other ways between two steps.
const half = madeIn(patterns[3].slice(0, 6));
delete half[patterns[3][2]];
half[patterns[3][9]] = 2;
(half as Record<string, number>).other = 3;
half[patterns[3][2]] = 4;
console.log(JSON.stringify(half), Object.keys(Object.freeze(again(patterns[4]))).join(""));
for (let round = 0; round < 3; round++) {
  Bun.gc(true);
  hold(again(patterns[round]), patterns[round].join(""));
  hold(madeIn(patterns[round]), patterns[round].join(""));
}
console.log(wrong);
