import { test } from "bun:test";
import { codes, cut } from "./app";
test("the file behind it", () => {
  console.log(codes(["ab", "cd"].join("")), cut(["ab", "cd"].join("")));
});
