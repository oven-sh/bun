// assigns an object of unknown type to a new object whose three optional fields are absent
type Options = { a: number; b?: string; c?: number; d?: boolean };
const kept: { [name: string]: any } = {};
kept.first = { a: 2, b: "x", c: 3, d: true };
kept.second = { a: 5, b: "y", c: 6, d: false };
function merge(into: Options, from: any): Options {
  return Object.assign(into, from);
}
const operations = 40;
let sum = 0;

kernel: {
  for (let i = 0; i < operations; i++) {
    const made = merge({ a: i }, i & 1 ? kept.first : kept.second);
    sum += made.a + made.c!;
  }
}

console.log(sum);
