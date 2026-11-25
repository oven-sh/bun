import { mock, test, vi } from "bun:test";
import { app } from "./app";
import * as first from "./barrel";
import { greet as direct } from "./dep";

test("a file that left the cache is mocked", async () => {
  delete require.cache[require.resolve("./barrel")];
  const barrel: any = await import("./barrel");
  mock.module("./barrel", () => ({ greet: () => "mocked" }));
  console.log("mocked", first.greet(), barrel.greet(), direct(), app());
  vi.doUnmock("./barrel");
  console.log("unmocked", first.greet(), barrel.greet(), direct(), app());
  const later: any = await import("./barrel");
  console.log("later", later.greet(), later === barrel);
});
