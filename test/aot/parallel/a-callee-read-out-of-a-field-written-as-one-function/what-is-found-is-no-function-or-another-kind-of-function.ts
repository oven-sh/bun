namespace Checks {
  export function check(passes: unknown, message?: string): string {
    return passes ? "passes" : "fails: " + message;
  }
}
const said: string[] = [];
const flags: boolean[] = JSON.parse("[true, false]");
function run(flag: boolean, also: boolean): void {
  try {
    said.push(String(Checks.check(flag && (said.push("operand"), also), "asked")));
  } catch (error) {
    said.push((error as Error).constructor.name);
  }
}
const kept = Checks.check;
const found: unknown[] = [5, undefined, null, "text", {}, Math.abs, kept.bind(null, false), class { constructor() {} }, async () => "later", function* () {}, new Proxy(kept, {}), kept];
for (const value of found) {
  (Checks as any).check = value;
  run(flags[0], flags[0]);
  run(flags[0], flags[1]);
}
console.log(said.join(" | "));
