import { spyOn, test } from "bun:test";
import * as between from "./src/between";
import { read } from "./src/reader";
test("a", () => {
  Bun.plugin({ name: "r", setup(build) { build.onResolve({ filter: /\?nobody-asks-for-this$/ }, () => undefined); } });
  const spy = spyOn(between, "who").mockReturnValue("spied");
  console.log("SEEN", between.who(), read(), between.own());
  spy.mockRestore();
  console.log("SEEN", between.who(), read(), between.own());
});
