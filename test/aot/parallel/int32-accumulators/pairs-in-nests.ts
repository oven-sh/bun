// A nest whose callee loops over the same list and returns pairs: integers, fractions, reads behind the end, holes.
const parse = (text: string): number[] => JSON.parse(text);
const ints = parse("[" + Array.from({ length: 40 }, (_, k) => (k * 977) % 1009).join() + "]"), doubles = ints.map(x => x / 4), odd = parse('[1,2,"3",4,null,6,7,8]'), few = parse("[7,3]"), none: number[] = [], holes = parse("[5,6,7,8,9,1,2]"); delete holes[3];
function divide(a: number, b: number): [quotient: number, remainder: number] { return [Math.floor(a / b), a % b]; }
function bounds(values: number[], from: number): { low: number; high: number } {
  let low = values[from]!, high = values[from]!;
  for (let i = from + 1; i < from + 4 && i < values.length; i++) { if (values[i]! < low) low = values[i]!; if (values[i]! > high) high = values[i]!; }
  return { low, high };
}
function past(values: number[], from: number): number { let last = 0; for (let i = from; i < from + 3; i++) last = values[i]!; return last; }
function run(list: number[], n: number) { let total = 0; for (let i = 0; i < n; i++) for (let k = 0; k < list.length; k++) { const [quotient, remainder] = divide(list[k]!, 17 + (k & 7)); const { low, high } = bounds(list, k); total += quotient + remainder + high - low; } return total; }
function ends(list: number[], n: number) { let total = 0; for (let i = 0; i < n; i++) for (let k = 0; k < list.length; k++) { const x = past(list, k); total = (total + (x === undefined ? 1 : x) + list[k]!) | 0; } return total; }
for (const [name, list] of [["ints", ints], ["doubles", doubles], ["odd", odd], ["few", few], ["none", none], ["holes", holes]] as [string, number[]][]) for (const f of [run, ends]) console.log(name, f.name, String(f(list, 3)));
