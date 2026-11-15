import { mock, test, vi } from "bun:test";
import { app } from "./app";
import * as first from "./barrel";
import { greet as direct } from "./dep";

test("the mock of a load from before a reset ends there", async () => {
  delete require.cache[require.resolve("./barrel")];
  const barrel: any = await import("./barrel");
  mock.module("./barrel", () => ({ greet: () => "mocked" }));
  vi.resetModules();
  const again: any = await import("./dep");
  console.log("mocked", first.greet(), barrel.greet(), direct(), app(), again.greet());
  vi.doUnmock("./barrel");
  console.log("unmocked", first.greet(), barrel.greet(), direct(), app(), again.greet());
});
