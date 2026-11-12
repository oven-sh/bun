import { test } from "bun:test";
import util from "node:util";
test("by way of ({}).constructor", () => {
  const holder: any = ({} as any).constructor;
  const kept = holder.keys;
  holder.keys = () => ["b"];
  let made: unknown;
  try { made = (util as any)._extend({}, { a: 1, b: 2 }); } finally { holder.keys = kept; }
  console.log(JSON.stringify(made));
});
