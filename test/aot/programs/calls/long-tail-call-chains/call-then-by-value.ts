// Functions with a rest parameter call each other in tail position a million times: f0 passes its first rest element with call(); f1 spreads its rest array to a function read out of an array. The chain starts in a loop at the top of the module. The last call reads past the end of its rest array.
// The time grows with the number of calls, and no frame stays behind. The output is that of plain Bun.
"use strict";
type Value = number | string;
function unused(n: number, ...rest: Value[]): string {
  if (n === 2) rest[0] = "changed";
  return f0(n - 1, rest[0], rest[1]);
}
function f0(n: number, ...rest: Value[]): string {
  if (n <= 0) return "f0 " + rest.length + ":" + rest[0] + "," + rest[1];
  return f1.call(undefined, n - 1, rest[0]);
}
function f1(n: number, ...rest: Value[]): string {
  if (n === -2) return String(rest[1]) + n + "1";
  return picked[0](n - 1, ...rest);
}
const table = { unused, f0, f1 };
const picked = [f0, f1];
const names = ["unused", "f0"] as const;
for (let turn = 0; turn < 3; turn++) console.log(table[names[1]](1000000, 0, 1));
