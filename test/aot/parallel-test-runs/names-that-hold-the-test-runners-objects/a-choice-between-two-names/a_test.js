import { jest, test } from "bun:test";
import { load } from "./deep/loader.js";
const other = jest;
const actual = (first) => (first ? jest : other).requireActual("./beside.cjs");
test("whose folder", () => {
  console.log(load(() => actual(true)), "|", load(() => actual(false)), "|", load(actual));
});
