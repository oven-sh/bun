import { expect, test } from "bun:test";
import { conf } from "./holder.mjs";

// No bundle is made for a test run: the loader has the file as what was asked for first when the run came to it.
const loaded = await import("./conf.toml", { with: { type: "text" } });
console.log(typeof conf, typeof loaded.default, Object.keys(loaded).sort().join());
test("the call gets what the statement has loaded", () => {
  expect(loaded.default).toBe(conf);
});
