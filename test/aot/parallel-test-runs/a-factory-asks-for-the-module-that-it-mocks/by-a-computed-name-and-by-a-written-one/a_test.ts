// The host resolves the computed name to the key of the original, as it does for any running factory. That key is the compiled module too: one instance, whose body runs once.
import { test, mock } from "bun:test";
const name = (text: string) => process.env.NOBODY_SETS_THIS || text;
mock.module("./tax", async () => {
  const [one, two] = await Promise.all([import(name("./tax")), import("./tax")]);
  return { ...one, rate: "mock rate", same: one === two };
});
test("a", async () => { const reader = await import("./reader"); console.log("a", reader.read()); });
