import { mock, test, vi } from "bun:test";
import fs from "node:fs";
import "./barrel";

let reads = 0;
let throws = true;
Object.defineProperty(fs, "ReadStream", {
  configurable: true,
  enumerable: true,
  get() {
    reads++;
    if (throws) throw new RangeError("read " + reads);
    return () => "real " + reads;
  },
});

const said = (act: () => unknown) => {
  try {
    return act();
  } catch (error: any) {
    return error.name + ": " + error.message;
  }
};

test("a mock of what can't be read", async () => {
  delete require.cache[require.resolve("./barrel")];
  const barrel: any = await import("./barrel");
  console.log("loaded", reads);
  said(() => mock.module("./barrel", () => ({ ReadStream: () => "mocked" })));
  console.log("mocked", reads, said(() => barrel.ReadStream()));
  console.log("unmocked", said(() => vi.doUnmock("./barrel") && "done"), reads, said(() => barrel.ReadStream()));
  throws = false;
});
