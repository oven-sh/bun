namespace Tools {
  export function whose(this: unknown, first?: unknown, second?: unknown): string {
    return (this === Tools ? "the namespace" : typeof this) + " " + arguments.length + " " + String(first) + " " + String(second);
  }
}
const said: string[] = [];
const flags: boolean[] = JSON.parse("[true, false]");
function never(): string {
  return "never";
}
if (flags.length > 9) (Tools as any).whose = never;
function run(flag: boolean, also: boolean): void {
  said.push(Tools.whose());
  said.push(Tools.whose(flag && also));
  said.push(Tools.whose(flag || also, flag ? 1 : 2));
  said.push((Tools.whose as any)(flag && also, 2, 3, also ? 4 : 5));
}
run(flags[0], flags[1]);
run(flags[1], flags[1]);
console.log(said.join(" | "));
