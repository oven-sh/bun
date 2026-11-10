import { jest, test } from "bun:test";
import { load } from "./deep/loader.js";
const alias = jest;
const actual = () => alias.requireActual("./beside.cjs");
test("whose folder", () => {
  console.log(load(actual));
});
