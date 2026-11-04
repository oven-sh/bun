// `import.meta.require` IS a loader: handed on, it still opens the run, and the load under a made name works.
import { test } from "bun:test";

const take = it => it;
test("t", () => {
  console.log(typeof take(import.meta.require)("node:" + ["o", "s"].join("")).platform());
});
