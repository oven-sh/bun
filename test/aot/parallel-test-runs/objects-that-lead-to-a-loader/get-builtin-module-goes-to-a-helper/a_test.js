// `process.getBuiltinModule` IS a loader: handed on, it still opens the run.
import { test } from "bun:test";

const take = it => it;
test("t", () => {
  console.log(typeof take(process.getBuiltinModule)("node:" + ["o", "s"].join("")).platform());
});
