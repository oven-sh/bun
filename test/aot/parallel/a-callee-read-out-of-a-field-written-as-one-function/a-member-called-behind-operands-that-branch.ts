namespace Checks {
  export let failures = 0;
  export function check(passes: unknown, message?: string): void {
    if (!passes) {
      failures++;
      said.push("failed: " + (message ?? "no message"));
    }
  }
  export function twice(value: number): number {
    return value * 2;
  }
}
const said: string[] = [];
const numbers: number[] = JSON.parse("[0, 1, 5, 9, 12]");
function never(passes: unknown): void {
  said.push("never " + passes);
}
if (numbers.length > 9) {
  (Checks as any).check = never;
  (Checks as any).twice = never;
}
function inRange(value: number): number {
  Checks.check(value >= 1 && value <= 9, "out of range");
  Checks.check(value === 0 || value > 0, "negative");
  return Checks.twice(value > 5 ? value - 5 : value);
}
let sum = 0;
for (const value of numbers) sum += inRange(value);
console.log(sum, Checks.failures, said.join(" | "));
