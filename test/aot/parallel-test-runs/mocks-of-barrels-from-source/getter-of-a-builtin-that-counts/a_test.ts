import { mock, test, vi } from "bun:test";
import fs from "node:fs";
import "./barrel";

let reads = 0;
Object.defineProperty(fs, "ReadStream", {
  configurable: true,
  enumerable: true,
  get() {
    reads++;
    return () => "real " + reads;
  },
});

test("a mock of what nobody has read yet", async () => {
  delete require.cache[require.resolve("./barrel")];
  const barrel: any = await import("./barrel");
  console.log("loaded", reads);
  mock.module("./barrel", () => ({ ReadStream: () => "mocked" }));
  console.log("mocked", reads, barrel.ReadStream());
  vi.doUnmock("./barrel");
  console.log("unmocked", reads, barrel.ReadStream());
});
