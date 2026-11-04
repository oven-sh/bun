// The helper loads through `process` a module that the program imports anyway: it is there.
import { test } from "bun:test";

const take = it => it;
import os from "node:os";
test("t", () => {
  console.log(take(process).getBuiltinModule("node:" + ["o", "s"].join("")) === os || typeof os.platform());
});
