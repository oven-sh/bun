// The variable of a loop holds a function that every turn tests, calls and replaces by what the call gives back. The loop ends when that is undefined.
function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
type Link = (x: number) => Link | undefined;
let seen = 0;
function link(list: number[], left: number): Link {
  return x => {
    seen = mix(seen, list[x & 1]! + left);
    return left === 0 ? undefined : left % 3 === 0 ? last : link([left, x], left - 1);
  };
}
const last: Link = x => {
  seen = mix(seen, x);
  return undefined;
};
function work(first: Link | undefined): number {
  let turns = 0;
  for (let next = first; next !== undefined; turns++) next = next(turns);
  return turns;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(i % 6 === 5 ? undefined : link([i, i + 1], i % 6)));
console.log(total, seen);
