namespace Checks {
  export function check(passes: unknown, message?: string): string {
    return (passes ? "passes" : "fails: " + message) + " " + String((check as any).mark);
  }
}
const said: string[] = [];
const flags: boolean[] = JSON.parse("[true, false]");
function never(): string {
  return "never";
}
if (flags.length > 9) (Checks as any).check = never;
function run(flag: boolean, also: boolean): void {
  said.push(Checks.check(flag && also, "asked"));
}
run(flags[0], flags[0]);
(Checks.check as any).mark = "marked";
run(flags[0], flags[1]);
Object.setPrototypeOf(Checks.check, null);
run(flags[1], flags[0]);
Object.freeze(Checks.check);
run(flags[0], flags[0]);
console.log(said.join(" | "));
