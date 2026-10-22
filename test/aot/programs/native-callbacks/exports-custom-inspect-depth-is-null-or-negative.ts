// Exports of start-up modules: util.inspect passes null as the depth where { depth: null } was asked for, while the method's parameter says number and the program's own call passes one.
import { inspect } from "node:util";

let total = 0;

class Level {
  constructor(public below: Level | null) {}
  [inspect.custom](depth: number, options: { depth?: number | null }, again: typeof inspect): string {
    total += typeof depth === "number" ? 1 : depth === null ? 100 : 10000;
    total += depth + 1 > 0 ? 1000000 : 0;
    return this.below ? "(" + again(this.below, { ...options, depth: options.depth == null ? null : options.depth - 1 }) + ")" : "end";
  }
}

const chain = new Level(new Level(new Level(null)));
chain[inspect.custom](2, { depth: 2 }, inspect);
const texts = [inspect(chain, { depth: null }), inspect(chain, { depth: 0 }), inspect(chain, { depth: -5 }), inspect(chain, { depth: Infinity }), inspect({ a: { b: { c: chain } } }, { depth: 1 })];
console.log(total, texts.join("").length);
