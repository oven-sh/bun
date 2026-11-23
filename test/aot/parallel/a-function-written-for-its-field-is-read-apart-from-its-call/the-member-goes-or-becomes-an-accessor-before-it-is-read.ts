namespace Checks {
  export function check(passes: unknown, message?: string): string {
    return passes ? "passes" : "fails: " + message;
  }
  export function other(passes: unknown): string {
    return "other: " + String(passes);
  }
}
const said: string[] = [];
const flags: boolean[] = JSON.parse("[true, false]");
function operand(name: string, value: boolean): boolean {
  said.push("operand " + name);
  return value;
}
function run(flag: boolean, also: boolean): void {
  try {
    said.push(Checks.check(operand("first", flag) && operand("second", also), "asked"));
  } catch (error) {
    said.push((error as Error).constructor.name);
  }
}
for (let round = 0; round < 3; round++) run(flags[0], flags[round & 1]);
const kept = Checks.check;
delete (Checks as any).check;
run(flags[0], flags[0]);
Object.setPrototypeOf(Checks, { check(passes: unknown) { return "from above: " + String(passes); } });
run(flags[0], flags[0]);
Object.defineProperty(Checks, "check", { configurable: true, get() { said.push("the accessor runs"); return kept; } });
run(flags[0], flags[1]);
Object.defineProperty(Checks, "check", { configurable: true, writable: true, value: Checks.other });
run(flags[0], flags[0]);
(Checks as any).check = kept;
run(flags[1], flags[0]);
(Checks as any).check = undefined;
run(flags[0], flags[0]);
(Checks as any).check = kept;
Object.freeze(Checks);
run(flags[0], flags[0]);
console.log(said.join(" | "));
