// Exports of start-up modules: the stylize function that console.log and util.inspect hand to a custom inspect method is called by the program with values that are no strings.
import { inspect } from "node:util";

let total = 0;

class Tag {
  [inspect.custom](depth: number, options: { stylize(text: string, style: string): string }): string {
    const odd: any[] = [42, undefined, null, true, 7n, ["a", 1], { toString: () => "object" }];
    for (const value of odd) {
      const styled: unknown = options.stylize(value, "number");
      total += typeof styled === "string" ? styled.length : typeof styled === "number" ? 1000 : 10;
    }
    total += String(options.stylize("text", "no such style")).length * 100000;
    total += String((options.stylize as any)()).length * 1000000;
    return "tag";
  }
}

const plain = inspect(new Tag());
const colored = inspect(new Tag(), { colors: true });
console.log(new Tag());
console.log(plain.length + colored.length, total);
