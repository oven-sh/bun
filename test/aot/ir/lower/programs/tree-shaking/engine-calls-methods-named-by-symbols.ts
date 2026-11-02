// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2

// FILE: main.ts
// for-of, spread, a pattern, for-await, an addition, instanceof, using, String.prototype.split and replace, Object.prototype.toString and Array.from call methods whose keys are well-known symbols.
import { Range, Ticks, Amount, Even, Resource, Comma, Tagged, log } from "./protocols";

console.log([...new Range(3)].join(), Array.from(new Range(2)).join(), Math.max(...new Range(5)));
const [first, second] = new Range(9);
console.log(first, second);
for (const value of new Range(1)) console.log("for-of", value);
for await (const tick of new Ticks()) console.log("for-await", tick);
console.log(`${new Amount()}`, +new Amount(), (new Amount() as any) + "");
console.log((2 as any) instanceof Even, (3 as any) instanceof Even);
{
  using resource = new Resource("sync");
  await using other = new Resource("async");
  log.push("in the block");
}
console.log(log.join(", "));
console.log("a,b".split(new Comma() as any), "a,b".replace(new Comma() as any, "-"));
console.log(Object.prototype.toString.call(new Tagged()));

// FILE: protocols.ts
export const log: string[] = [];
function* upTo(n: number) { for (let i = 0; i < n; i++) yield i; }
async function* ticks() { yield "tick"; yield "tock"; }
function hinted(hint: string) { return hint === "number" ? 7 : "hint " + hint; }
function isEven(value: unknown) { return typeof value === "number" && value % 2 === 0; }
function closed(name: string) { log.push("closed " + name); }

export class Range {
  constructor(public end: number) {}
  [Symbol.iterator]() { return upTo(this.end); }
}
export class Ticks {
  [Symbol.asyncIterator]() { return ticks(); }
}
export class Amount {
  [Symbol.toPrimitive](hint: string) { return hinted(hint); }
}
export class Even {
  static [Symbol.hasInstance](value: unknown) { return isEven(value); }
}
export class Resource {
  constructor(public name: string) {}
  [Symbol.dispose]() { closed(this.name); }
  async [Symbol.asyncDispose]() { closed(this.name); }
}
export class Comma {
  [Symbol.split](text: string) { return "split " + text; }
  [Symbol.replace](text: string, by: string) { return "replace " + text + " " + by; }
}
export class Tagged {
  get [Symbol.toStringTag]() { return "Custom"; }
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
