// reader.ts was linked by the file before. The mock takes it out of the loader, nobody loads it again, and the binding held here keeps the real dep.ts.
import { read } from "./reader";
import { test, vi } from "bun:test";
vi.doMock("./dep", () => ({ value: () => "mock b" }));
test("b", async () => {
  const later = await import("./later");
  console.log("b", read(), later.seen());
});
