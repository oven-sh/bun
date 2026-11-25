import { test } from "bun:test";
import util from "node:util";
test("Bun's own code meets what the test has put on Object", () => {
  const holder: any = (globalThis as any)[JSON.parse('"Object"')];
  const kept = holder.keys;
  holder.keys = () => ["b"];
  let made: unknown;
  try { made = (util as any)._extend({}, { a: 1, b: 2 }); } finally { holder.keys = kept; }
  console.log(JSON.stringify(made));
});
