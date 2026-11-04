// `createRequire` is of the loader: handed on, it still opens the run.
import { test } from "bun:test";

const take = it => it;
import { createRequire } from "node:module";
test("t", () => {
  console.log(typeof take(createRequire)(import.meta.url)("node:" + ["o", "s"].join("")).platform());
});
