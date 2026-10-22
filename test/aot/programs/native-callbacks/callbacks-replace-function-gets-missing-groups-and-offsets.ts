// Callbacks handed over: replace and replaceAll call the function with (match, groups.., offset, string, named groups): a group that took no part is undefined, and with fewer groups the offset lands in a string parameter.
let total = 0;

function swap(match: string, first: string, second: string, offset: number): string {
  total += typeof first === "string" ? 1 : first === undefined ? 100 : typeof first === "number" ? 10000 : 0;
  total += typeof second === "string" ? 100000 : second === undefined ? 1000000 : typeof second === "number" ? 10000000 : 0;
  total += typeof offset === "number" ? 0 : typeof offset === "string" ? 100000000 : 200000000;
  return second + "" + first;
}

swap("ab", "a", "b", 0);
const results = [
  "ab cd".replace(/(\w)(\w)/g, swap),
  "ab".replace(/(a)|(z)/, swap),
  "ab".replace(/(b)/, swap),
  "ab".replace("b", swap),
  "abab".replaceAll("a", swap),
  "ab".replace(/(?<x>a)(?<y>q)?/, swap),
];
console.log(total, results.join(" "));
