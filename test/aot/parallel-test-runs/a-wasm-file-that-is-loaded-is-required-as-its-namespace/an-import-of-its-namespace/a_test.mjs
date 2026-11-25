import { test } from "bun:test";
import * as names from "./sums.wasm";
const show = (name, value) => console.log(name, typeof value, typeof value === "object" ? typeof value.default : "");
test("a", () => {
  show("import", names);
  show("require", require("./sums.wasm"));
});
