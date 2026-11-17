import { plugin } from "bun";
import { mock, test, vi } from "bun:test";
import { join } from "node:path";
import { app } from "./app";
import * as first from "./barrel";
import { greet as direct } from "./dep.cjs";

plugin({
  name: "barrels",
  setup(build) {
    build.onLoad({ filter: /made-barrel\.ts$/ }, () => ({
      contents: `export * from "./dep.cjs";`,
      loader: "ts",
    }));
  },
});

test("a file that left the cache hands on a CommonJS file", async () => {
  delete require.cache[require.resolve("./barrel")];
  const barrel: any = await import("./barrel");
  mock.module("./barrel", () => ({ greet: () => "mocked" }));
  console.log("mocked", first.greet(), barrel.greet(), direct(), app());
  vi.doUnmock("./barrel");
  console.log("unmocked", first.greet(), barrel.greet(), direct(), app());
});

test("a file that a plugin gives hands on a CommonJS file", async () => {
  const path = join(import.meta.dir, "made-" + "barrel.ts");
  const barrel: any = await import(path);
  mock.module(path, () => ({ greet: () => "mocked again" }));
  console.log("mocked", barrel.greet(), direct(), app());
});
