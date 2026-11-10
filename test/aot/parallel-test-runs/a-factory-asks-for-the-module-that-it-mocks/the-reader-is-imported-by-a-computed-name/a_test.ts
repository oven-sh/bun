// The reader goes by a name that the build cannot tell, so it runs from its text and the loader fetches the mocked module for it: the factory runs inside that fetch.
import { test, mock } from "bun:test";
const name = (text: string) => process.env.NOBODY_SETS_THIS || text;
mock.module("./tax", async () => {
  const [one, two] = await Promise.all([import("./tax"), import("./tax")]);
  return { ...one, rate: "mock rate", same: one === two };
});
test("a", async () => { const reader = await import(name("./reader")); console.log("a", reader.read()); });
