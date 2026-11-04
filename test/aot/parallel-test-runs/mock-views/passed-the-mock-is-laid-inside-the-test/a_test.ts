// 
import { vi, test } from "bun:test";
import { read } from "./reader";
test("views", async () => {
  vi.doMock("./dep", () => ({ v: () => "mocked" }));
  const later = await import("./later");
  console.log(read(), "|", later.seen());
});
