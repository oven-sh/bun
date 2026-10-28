// The methods of Array.prototype that take a callback, the callback written at the call, each call in a function of its own that is handed the array: as programs are written.
// The function knows the array by its type alone. On such an array some() cost twenty times the loop written by hand: the method was not taken in, its one copy for all callers
// read each double through the stub for any key, and the result of filter() grew in the run time at its second and its fourth element.
const written: number[] = [1, 2, 3, 4, 5, 6, 7, 8];
const parsed = JSON.parse("[1,2,3,4,5,6,7,8]") as number[];
const texts = JSON.parse('["a","b","c","d","e","f","g","h"]') as string[];
const items = JSON.parse('[{"n":1},{"n":2},{"n":3},{"n":4},{"n":5},{"n":6},{"n":7},{"n":8}]') as { n: number }[];

function loop(list: number[]): boolean { for (const v of list) if (v < 0) return true; return false; }
function some(list: number[]): boolean { return list.some((v) => v < 0); }
function someCaptures(list: number[], limit: number): boolean { return list.some((v) => v < -limit); }
function every(list: number[]): boolean { return list.every((v) => v > 0); }
function sum(list: number[]): number { let total = 0; list.forEach((v) => { total += v; }); return total; }
function doubled(list: number[]): number { return list.map((v) => v * 2).length; }
function large(list: number[]): number { return list.filter((v) => v > 4).length; }
function found(list: number[]): number | undefined { return list.find((v) => v > 7); }
function foundAt(list: number[]): number { return list.findIndex((v) => v > 7); }
function folded(list: number[]): number { return list.reduce((total, v) => total + v, 0); }
function largeDoubled(list: number[]): number { return list.filter((v) => v > 4).map((v) => v * 2).length; }
function longTexts(list: string[]): number { return list.filter((v) => v.length > 0).length; }
function hasText(list: string[], wanted: string): boolean { return list.some((v) => v === wanted); }
function numbersOf(list: { n: number }[]): number { return list.map((item) => item.n).length; }
function largeItems(list: { n: number }[]): number { return list.filter((item) => item.n > 4).length; }

let total = 0;
for (let round = 0; round < 20000; round++) {
  for (const list of [written, parsed]) {
    if (loop(list)) total++;
    if (some(list)) total++;
    if (someCaptures(list, round)) total++;
    if (every(list)) total++;
    total += sum(list) + doubled(list) + large(list) + (found(list) ?? 0) + foundAt(list) + folded(list) + largeDoubled(list);
  }
  total += longTexts(texts) + numbersOf(items) + largeItems(items);
  if (hasText(texts, "h")) total++;
}
console.log(total);
