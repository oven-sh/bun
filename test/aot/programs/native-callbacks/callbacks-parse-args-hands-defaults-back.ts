// Native bindings of the library: util.parseArgs is native code that reads its configuration through getters and puts the `default` of an option into its result as it is, so a function under the type string comes back and is called.
import { parseArgs } from "node:util";

let total = 0;

function fallback(value: number): void {
  total += typeof value === "number" ? 1 : 100;
}

fallback(1);
class Options {
  get name(): object {
    total += 10000;
    return { type: "string", short: "n", default: "nobody" };
  }
}
const options: any = Object.defineProperty({ flag: { type: "boolean" } }, "name", { enumerable: true, get: () => new Options().name });
const parsed = parseArgs({ args: ["--flag", "-n", "x", "rest"], options, allowPositionals: true });
let refused = "";
try {
  const odd = parseArgs({ args: [], options: { hook: { type: "string", default: fallback as any } } });
  (odd.values.hook as any)("text");
} catch (error) {
  refused = (error as NodeJS.ErrnoException).code ?? (error as Error).name;
}
console.log(total, JSON.stringify(parsed.values), parsed.positionals.join(), refused);
