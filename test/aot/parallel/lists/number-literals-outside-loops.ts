// Literals that are written to hold numbers, outside loops, with elements that nobody has proven: int32s, doubles, -0, NaN, what is no number after all.
const show = (v: unknown): string => (Array.isArray(v) ? "[" + v.map(show).join() + "]" : Object.is(v, -0) ? "-0" : typeof v === "string" ? JSON.stringify(v) : String(v));
const line = (...all: unknown[]): void => console.log(all.map(show).join(" "));
interface Pair {
  a: number;
  b: number;
}
function one(p: Pair): number[] {
  return [p.a];
}
function two(p: Pair): number[] {
  return [p.a, p.b];
}
function three(p: Pair): number[] {
  return [p.b, p.a, p.b];
}
function four(p: Pair): number[] {
  return [p.a, p.b, p.a, p.b];
}
function five(p: Pair): number[] {
  return [p.a, p.b, p.a, p.b, p.a];
}
const pairs: Pair[] = JSON.parse('[{"a":1,"b":2},{"a":1,"b":2.5},{"a":-0,"b":2147483647},{"a":2147483648,"b":-2147483648},{"a":0.1,"b":0.2},{"a":"x","b":1},{"a":null,"b":1.5},{"b":3}]');
pairs.push({ a: NaN, b: 1 }, { a: 1, b: NaN }, { a: 1e308 * 10, b: 5e-324 });
const first: Pair = pairs[0]!;
line(one(first), two(first), three(first), four(first), five(first));
const second: Pair = pairs[1]!;
line(one(second), two(second), three(second), four(second), five(second));
const rest = pairs.slice(2);
rest.forEach(p => line(one(p), two(p), three(p), four(p), five(p)));
// The arrays grow, change their kind and stay apart.
const grown = two(first);
grown.push(3);
grown[0] = 0.5;
(grown as unknown[])[1] = "s";
line(grown, two(first));
const sum = (l: number[]): number => {
  let s = 0;
  for (let i = 0; i < l.length; i++) s += l[i]!;
  return s;
};
line(sum(two(first)), sum(three(second)), sum(four(pairs[4]!)), sum(five(pairs[3]!)));
