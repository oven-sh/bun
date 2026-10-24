// Untyped programs: e math max as callback. It prints what plain Bun prints.
type Pick = (a: number, b: number) => number;
function apply(pick: Pick): number {
  return pick(1, 2);
}
const chosen: Pick = process.argv.length > 99 ? (a, b) => a - b : Math.max;
console.log(apply(chosen));
