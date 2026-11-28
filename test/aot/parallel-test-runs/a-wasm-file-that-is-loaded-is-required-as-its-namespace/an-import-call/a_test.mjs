import { test } from "bun:test";
const show = (name, value) => console.log(name, typeof value, typeof value === "object" ? typeof value.default : "");
test("a", async () => {
  show("import", await import("./sums.wasm"));
  show("require", require("./sums.wasm"));
});
