import { spyOn, test } from "bun:test";
import * as between from "./src/between";
import { read } from "./src/reader";
test("a", () => {
  Bun.plugin({ name: "m", setup(build) { build.module("made-by-a-plugin", () => ({ exports: { made: 1 }, loader: "object" })); } });
  const spy = spyOn(between, "who").mockReturnValue("spied");
  console.log("SEEN", between.who(), read(), between.own());
  spy.mockRestore();
  console.log("SEEN", between.who(), read(), between.own());
});
