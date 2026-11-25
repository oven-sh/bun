import { mock, test, vi } from "bun:test";
import fs from "node:fs";
import "./barrel";

let reads = 0;
Object.defineProperty(fs, "ReadStream", {
  configurable: true,
  enumerable: true,
  get() {
    reads++;
    const value = () => "replaced " + reads;
    Object.defineProperty(fs, "ReadStream", { configurable: true, enumerable: true, writable: true, value });
    return value;
  },
});

test("a mock of what replaces itself", async () => {
  delete require.cache[require.resolve("./barrel")];
  const barrel: any = await import("./barrel");
  for (const round of ["first", "second"]) {
    mock.module("./barrel", () => ({ ReadStream: () => round + " mock" }));
    console.log("mocked", reads, barrel.ReadStream());
    vi.doUnmock("./barrel");
    console.log("unmocked", reads, barrel.ReadStream());
  }
});
