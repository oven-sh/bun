import { test } from "bun:test";
import { createRequire } from "node:module";
import { price } from "./price.ts";
import * as costs from "./cost.cjs";

const require = createRequire(import.meta.url);
const readers: (() => string)[] = ((globalThis as any).readers ??= []);
readers.push(() => `a ${price()}, ${costs.cost()}`);

test("a", () => {
  for (const read of readers) console.log(read());
  delete require.cache[require.resolve("./price.ts")];
  delete require.cache[require.resolve("./cost.cjs")];
});
