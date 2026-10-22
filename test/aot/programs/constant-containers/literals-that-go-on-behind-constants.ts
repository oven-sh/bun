// `[1, 2, ...rest]`: the constants in front are no whole literal: what follows is appended to the same array.
function spreadBehind(rest: number[]): number[] { return [1, 2, ...rest]; }
function spreadBetween(rest: number[]): number[] { return [1, 2, ...rest, 3, 4]; }
function spreadOfStrings(rest: string[]): string[] { return ["a", "b", ...rest, "c"]; }
function spreadOfIterable(rest: Iterable<number>): number[] { return [0.5, 1.5, ...rest]; }
function twoSpreads(a: number[], b: number[]): number[] { return [7, ...a, 8, ...b]; }
function spreadOfConstants(): number[] { return [1, 2, ...[3, 4], ...[5, 6]]; }
function holeBehind(rest: number[]): (number | undefined)[] { return [1, 2, ...rest, , 5]; }
function* numbers(n: number) { for (let i = 0; i < n; i++) yield i * 10; }
const show = (a: unknown[]) => JSON.stringify(a) + a.length;
for (let round = 0; round < 3; round++) {
  console.log(show(spreadBehind([])), show(spreadBehind([9])), show(spreadBehind([9, 8, 7, 6, 5, 4, 3, 2, 1])), show(spreadBetween([round])), show(spreadOfStrings(["x", "y"])), show(spreadOfIterable(numbers(round + 1))), show(spreadOfIterable(new Set([1, 2]))));
  console.log(show(twoSpreads([1], [2, 3])), show(spreadOfConstants()), show(holeBehind([round])), 3 in holeBehind([round]), spreadBehind([]) !== spreadBehind([]));
}
let sum = 0; for (let i = 0; i < 20000; i++) { const a = spreadBehind([i]), b = spreadOfStrings([String(i & 3)]); sum += a[2] + a.length + b[2].length + spreadOfConstants()[5]; } console.log(sum);
