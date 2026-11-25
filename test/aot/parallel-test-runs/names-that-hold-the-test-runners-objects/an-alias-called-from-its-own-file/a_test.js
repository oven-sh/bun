import { jest, test } from "bun:test";
const alias = jest;
const actual = () => alias.requireActual("./beside.cjs");
const { jest: required } = require("bun:test");
const second = () => required.requireActual("./beside.cjs");
test("whose folder", () => {
  const first = actual();
  console.log(first.where, "|", second().where);
});
