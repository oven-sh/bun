// A program that writes `int32` calls `Function` and an eval with texts that the build knows. It compiles the functions, and their calls have as many arguments as are written.
import type { int32 } from "bun";
function half(x: int32): int32 {
  return (x / 2) | 0;
}
const same = Function("value", "return value") as <T>(value: T) => T;
const made = new Function("a", "b", "return a + b") as (a: number, b: number) => number;
const read = (0, eval)("1 + 2") as number;
const list = ["value", "return value * 2"] as const;
const spread = Function(...list) as (value: number) => number;
console.log(same(5), made(1, 2), read, spread(4), half(same(8) | 0));
