// Callbacks handed over: sort and toSorted call the comparator with what the array really holds, strings and null out of JSON.parse under the type number[], while the program's own calls pass numbers.
let total = 0;

function byValue(a: number, b: number): number {
  total += typeof a === "number" ? 1 : typeof a === "string" ? 100 : 10000;
  total += typeof b === "number" ? 1 : typeof b === "string" ? 100 : 10000;
  return a - b;
}

byValue(1, 2);
const honest = [3, 1, 2].sort(byValue);
const given = JSON.parse('[3,"10",2,null,"1"]') as number[];
const sorted = given.toSorted(byValue);
given.sort(byValue);
console.log(total % 100, total > 10000, honest.join(), sorted.join(), given.map(one => typeof one).join());
