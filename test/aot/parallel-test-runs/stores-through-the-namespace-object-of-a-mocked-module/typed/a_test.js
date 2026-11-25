import { test, mock } from "bun:test";
mock.module("./lib.mjs", () => ({ rate: () => 10 }));
test("a store through the namespace object", async () => {
  const helper = await import("./helper.ts");
  if (helper.warm) console.log(helper.warm());
  let seen;
  try { seen = String(helper.swap()); } catch (e) { seen = "threw: " + e.constructor.name; }
  console.log(seen);
});
