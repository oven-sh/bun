// looks up a string that a Map holds, outside loops
const operations = 4;
let one: string = "one" + process.argv.length;
let two: string = "two" + process.argv.length;
let ages: Map<string, number> = new Map([
  [one, 1],
  [two, 2],
]);
let total = 0;

kernel: {
  total += ages.get(one)!;
  total += ages.get(two)!;
  total += ages.get(one)!;
  total += ages.get(two)!;
}

console.log(total);
