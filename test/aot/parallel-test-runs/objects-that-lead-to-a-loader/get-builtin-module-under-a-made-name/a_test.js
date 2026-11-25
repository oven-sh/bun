// `process.getBuiltinModule(<a made name>)`, called where the build sees it: the run is open.
import { test } from "bun:test";

const take = it => it;
test("t", () => {
  console.log(typeof process.getBuiltinModule("node:" + ["o", "s"].join("")).platform());
});
