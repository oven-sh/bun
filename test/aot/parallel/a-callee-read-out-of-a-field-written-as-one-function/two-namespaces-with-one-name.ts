namespace First {
  export function name(loud: unknown): string {
    return loud ? "FIRST" : "first";
  }
}
namespace Second {
  export function name(loud: unknown): string {
    return loud ? "SECOND" : "second";
  }
}
const said: string[] = [];
const flags: boolean[] = JSON.parse("[true, false]");
function run(which: typeof First, flag: boolean, also: boolean): void {
  said.push(which.name(flag && also));
  said.push(First.name(flag || also));
  said.push(Second.name(flag ? also : flag));
}
run(First, flags[0], flags[0]);
run(Second, flags[0], flags[1]);
(First as any).name = Second.name;
run(First, flags[1], flags[1]);
(Second as any).name = (loud: unknown) => "third " + loud;
run(Second, flags[0], flags[0]);
console.log(said.join(" | "));
