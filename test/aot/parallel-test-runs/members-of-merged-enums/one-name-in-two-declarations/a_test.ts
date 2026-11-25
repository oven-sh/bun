import { test } from "bun:test";
import { Level, read } from "./levels.ts";
test("the object holds what is stored last", () => {
  console.log(Level.Low, read(), Level.High);
});
