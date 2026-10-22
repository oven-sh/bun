// A native function that compiled code calls directly is still a function object like any other where the program treats it as a value.
// STATISTIC: NativeFunctionsCalledDirectly >= 2
import { isAbsolute, join } from "node:path";
function report(name: string, probe: () => unknown) {
  let answer: unknown;
  try {
    answer = probe();
  } catch (error) {
    answer = [(error as any).name, (error as any).code, (error as Error).message];
  }
  console.log(name, JSON.stringify(answer));
}
const table: Record<string, (value: string) => unknown> = { isAbsolute, join };
report("imported by name", () => [isAbsolute("/a"), join("a", "b")]);
report("through a table", () => Object.keys(table).map(name => table[name]("/a")));
report("call and apply", () => [isAbsolute.call(null, "/a"), join.apply(undefined, ["a", "b"]), join.bind(null, "x")("y")]);
report("its own properties", () => [isAbsolute.name, isAbsolute.length, typeof isAbsolute, join.name, join.length]);
