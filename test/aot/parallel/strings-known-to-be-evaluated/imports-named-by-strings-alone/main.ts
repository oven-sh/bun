// TypeScript drops an import that no code uses, and a string that the program evaluates is no such use.
import { used, value } from "./values";
import { unused } from "./dropped";
import { Kind } from "./kinds";
function tell(read: () => unknown): void {
  try {
    console.log(read());
  } catch (error) {
    console.log((error as Error).name);
  }
}
tell(() => eval("(function () { return value; })")());
tell(() => eval("(function () { return unused; })")());
tell(() => eval("(() => Kind.First)")());
tell(() => eval("(function () { return used; })")());
console.log(used);
