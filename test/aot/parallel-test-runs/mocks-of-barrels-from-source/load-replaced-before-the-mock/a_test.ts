import { mock, test, vi } from "bun:test";
import { app } from "./app";
import "./barrel";
import { greet as direct } from "./dep";

test("a barrel over a load that a later one has replaced is mocked twice", async () => {
  delete require.cache[require.resolve("./barrel")];
  const barrel: any = await import("./barrel");
  vi.doMock("./dep", () => ({ greet: () => "mock of the file" }));
  mock.module("./dep", () => ({ greet: () => "another mock" }));
  vi.doUnmock("./dep");
  const again: any = await import("./dep");
  console.log("loaded again", barrel.greet(), direct(), app(), again.greet());
  mock.module("./barrel", () => ({ greet: () => "mocked" }));
  console.log("mocked", barrel.greet(), direct(), app(), again.greet());
  vi.doUnmock("./barrel");
  console.log("unmocked", barrel.greet(), direct(), app(), again.greet());
  mock.module("./barrel", () => ({ greet: () => "mocked again" }));
  console.log("mocked", barrel.greet(), direct(), app(), again.greet());
  vi.doUnmock("./barrel");
  console.log("unmocked", barrel.greet(), direct(), app(), again.greet());
});
