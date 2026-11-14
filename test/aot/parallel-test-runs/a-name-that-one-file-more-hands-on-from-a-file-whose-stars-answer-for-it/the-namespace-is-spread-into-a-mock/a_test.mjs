import { mock, test } from "bun:test";
import * as real from "./u.mjs";
test("t", async () => {
  mock.module("./u.mjs", () => ({ ...real, more: 1 }));
  const { word } = await import("./u.mjs");
  console.log("SAID", word);
});
