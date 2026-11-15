import { plugin } from "bun";
import { expect, mock, test } from "bun:test";
import { join } from "node:path";
import { app } from "./app";
import { greet as direct } from "./dep";

plugin({
  name: "barrels",
  setup(build) {
    build.onLoad({ filter: /made-barrel\.ts$/ }, () => ({
      contents: `export { greet } from "./dep";`,
      loader: "ts",
    }));
  },
});

test("a file that a plugin gives is mocked till the end of the test file", async () => {
  const path = join(import.meta.dir, "made-" + "barrel.ts");
  const barrel: any = await import(path);
  expect(barrel.greet()).toBe("real 1");
  mock.module(path, () => ({ greet: () => "mocked" }));
  console.log("mocked", barrel.greet(), direct(), app());
});
