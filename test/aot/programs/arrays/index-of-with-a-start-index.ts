// Array.prototype.indexOf with a start index: strings, ropes, objects, booleans, holes, a start at and past the end, and starts the compiler cannot prove to be non-negative integers.
const words: string[] = ["", "a", "", "bc", "a", "longer than eight characters", ""];
const made = ["b", "c"].join("");
const long = ["longer than ", "eight characters"].join("");

function afterFirst(list: string[], word: string): number {
  return list.indexOf(word, 1);
}

function from(list: string[], word: string, start: number): number {
  return list.indexOf(word, start);
}

function fromCount(list: string[], word: string): number[] {
  const found: number[] = [];
  for (let start = 0; start <= list.length + 1; start++) found.push(list.indexOf(word, start));
  return found;
}

console.log(afterFirst(words, ""), afterFirst(words, "a"), afterFirst(words, made), afterFirst(words, long), afterFirst(words, "missing"), afterFirst([], ""), afterFirst([""], ""));
console.log(fromCount(words, "").join(), fromCount(words, "a").join(), fromCount(words, long).join());
console.log(from(words, "a", -3), from(words, "a", -100), from(words, "a", 1.5), from(words, "a", NaN), from(words, "a", Infinity), from(words, "", -1));

const first = { n: 1 };
const second = { n: 2 };
const objects = [first, second, first];
console.log(objects.indexOf(first, 1), objects.indexOf(second, 2), objects.indexOf(first, 3));

const flags: (boolean | null | undefined)[] = [true, false, null, undefined, true];
console.log(flags.indexOf(true, 1), flags.indexOf(null, 1), flags.indexOf(undefined, 1), flags.indexOf(false, 2));

const sparse: (string | undefined)[] = ["x", , "x", undefined];
console.log(sparse.indexOf("x", 1), sparse.indexOf(undefined, 0), sparse.indexOf(undefined, 1));

const numbers = [1, 2, 3, 1, 2.5];
console.log(numbers.indexOf(1, 1), numbers.indexOf(2.5, 1), numbers.indexOf(3, 3));

const match = "/users/42/posts/7".match(/^\/(?:async\/([^/]+)$()|users\/([^/]+)\/posts\/([^/]+)$())/)!;
console.log(match.indexOf("", 1), match.length);
