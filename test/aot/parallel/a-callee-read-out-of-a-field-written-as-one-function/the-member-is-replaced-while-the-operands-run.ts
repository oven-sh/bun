namespace Checks {
  export function check(passes: unknown, message?: string): void {
    said.push(passes ? "first passes" : "first fails: " + message);
  }
}
const said: string[] = [];
const flags: boolean[] = JSON.parse("[true, false, true]");
function other(passes: unknown, message?: string): void {
  said.push(passes ? "other passes" : "other fails: " + message);
}
function replaces(flag: boolean): boolean {
  if (!flag) (Checks as any).check = other;
  return flag;
}
function run(flag: boolean, also: boolean): void {
  Checks.check(replaces(flag) && also, "asked");
  Checks.check(also || flag, "asked again");
}
for (const flag of flags) run(flag, flags[0]);
console.log(said.join(" | "));
