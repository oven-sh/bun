// A call of a function held in a value, where only numbers cross, goes by the signature of the call: the function has a second entry that takes and yields them as they are. Such an entry is worth its bytes only where a closure of the function can get to such a call. One that is only ever called by its name or handed to a method of an array, a map or a promise, or to a function of the host, cannot: those call it the general way.
// IR+ ^function f\d+ "descending" \w+ role=SignatureEntrypoint
// IR+ ^function f\d+ "byLastDigit" \w+ role=SignatureEntrypoint
// IR+ ^function f\d+ "productOf" \w+ role=SignatureEntrypoint
// IR- ^function f\d+ "ascending" \w+ role=SignatureEntrypoint
// IR- ^function f\d+ "sumOf" \w+ role=SignatureEntrypoint
function ascending(a: number, b: number): number { return a - b; }
function descending(a: number, b: number): number { return b - a; }
function byLastDigit(a: number, b: number): number { return a % 10 - b % 10; }
function sumOf(sum: number, n: number): number { return sum + n; }
function productOf(product: number, n: number): number { return product * n; }

let compare: (a: number, b: number) => number = descending;
const held: { combine: (a: number, b: number) => number } = { combine: productOf };
function pick(flag: boolean): (a: number, b: number) => number { return flag ? byLastDigit : descending; }

const numbers: number[] = [];
for (let i = 0; i < 40; i++) numbers.push((i * 37) % 101 + 0.5);

console.log(numbers.slice().sort(ascending).slice(0, 5).join());
console.log(numbers.reduce(sumOf, 0));
console.log(ascending(3, 4), sumOf(3, 4));

let total = 0;
for (let i = 0; i < 1000; i++) {
  total += compare(i, 7.5) + held.combine(i, 0.5) + pick((i & 1) === 0)(i, 3.5);
  if (i === 500) compare = byLastDigit;
}
console.log(total);
