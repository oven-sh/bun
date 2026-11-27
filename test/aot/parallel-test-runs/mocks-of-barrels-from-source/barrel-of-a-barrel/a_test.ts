import { mock, test, vi } from "bun:test";
import { app } from "./app";
import * as first from "./barrel";
import { greet as direct } from "./dep";
import { inner } from "./inner";

test("a file that left the cache hands on a barrel", async () => {
  delete require.cache[require.resolve("./barrel")];
  const barrel: any = await import("./barrel");
  mock.module("./barrel", () => ({ greet: () => "mocked", inner: () => "mocked inner" }));
  console.log("mocked", first.greet(), barrel.greet(), direct(), app(), barrel.inner(), inner());
  vi.doUnmock("./barrel");
  console.log("unmocked", first.greet(), barrel.greet(), direct(), app(), barrel.inner(), inner());
});
