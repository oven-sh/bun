namespace Checks {
  export function check(passes: unknown, message?: string): void {
    if (!passes) said.push("fails: " + message);
  }
}
const said: string[] = [];
const numbers: number[] = JSON.parse("[0, 1, 5, 9, 12]");
function other(passes: unknown, message?: string): void {
  said.push("other " + passes + " " + message);
}
function run(limit: number): void {
  const check = Checks.check;
  for (const value of numbers) check(value >= 1 && value <= limit, "at " + value);
}
run(9);
(Checks as any).check = other;
run(5);
console.log(said.join(" | "));
