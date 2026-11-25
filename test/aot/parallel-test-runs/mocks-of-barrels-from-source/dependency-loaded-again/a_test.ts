import { mock, test, vi } from "bun:test";
import { app } from "./app";
import * as first from "./barrel";
import { greet as direct } from "./dep";

test("the mock ends in the load that it replaced", async () => {
  delete require.cache[require.resolve("./barrel")];
  const barrel: any = await import("./barrel");
  mock.module("./barrel", () => ({ greet: () => "mocked" }));
  delete require.cache[require.resolve("./dep")];
  const again: any = await import("./dep");
  console.log("mocked", first.greet(), barrel.greet(), direct(), app(), again.greet());
  vi.doUnmock("./barrel");
  console.log("unmocked", first.greet(), barrel.greet(), direct(), app(), again.greet());
  mock.module("./barrel", () => ({ greet: () => "mocked again" }));
  console.log("mocked", first.greet(), barrel.greet(), direct(), app(), again.greet());
  vi.doUnmock("./barrel");
  console.log("unmocked", first.greet(), barrel.greet(), direct(), app(), again.greet());
});
