// Exports of start-up modules: inspect.styles, inspect.colors and inspect.defaultOptions are objects of a start-up module that the program stores odd values into, and the library reads them back while it prints.
import { inspect } from "node:util";

const value = { n: 1, s: "text", list: [1, [2, [3, [4]]]], u: undefined };
const lengths: number[] = [inspect(value, { colors: true }).length];
(inspect.styles as any).number = "no such color";
(inspect.styles as any).string = 5;
(inspect.styles as any).undefined = "mine";
(inspect.colors as any).mine = ["<", ">"];
lengths.push(inspect(value, { colors: true }).length);
inspect.defaultOptions.depth = 0;
lengths.push(inspect(value).length);
inspect.defaultOptions = { depth: null, compact: false } as any;
lengths.push(inspect(value).length);
try {
  inspect.defaultOptions = 5 as any;
} catch (error) {
  lengths.push((error as NodeJS.ErrnoException).code!.length);
}
console.log(lengths.join(), inspect(undefined, { colors: true }).length);
