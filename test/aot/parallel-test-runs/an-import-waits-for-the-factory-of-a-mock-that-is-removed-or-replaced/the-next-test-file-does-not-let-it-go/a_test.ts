import { test, vi } from "bun:test";
vi.doMock("./kept", async () => (vi.doUnmock("./kept"), await new Promise(() => {})));
await import("./user");
console.log("SAID the first file goes on");
test("never runs", () => {});
