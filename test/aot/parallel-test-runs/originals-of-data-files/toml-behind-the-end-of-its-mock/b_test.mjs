import { jest, mock, test, vi } from "bun:test";
const show = it => Object.keys(it).sort().join() + " " + it.v;
test("b", async () => {
  console.log("b", show(require("./data.toml")), show(await import("./data.toml")));
});
