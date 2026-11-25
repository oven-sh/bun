import { test } from "bun:test";
const show = (name, value) => console.log(name, typeof value, typeof value === "object" ? typeof value.default : "");
test("a", () => {
  show("require", require("./sums.wasm"));
  show("again", require("./sums.wasm"));
});
