import { test } from "bun:test";
import imported from "./data.txt" with { type: "json" };
test("t", () => {
  const key = require.resolve("./data.txt");
  console.log(require.cache[key] === require.cache[key], require.cache[key].exports === imported);
});
