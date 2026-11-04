// 
import { vi, test } from "bun:test";
import { read } from "./reader";
vi.doMock("./dep", () => ({ v: () => "mocked" }));
test("views", async () => {
  const later = await import("./later");
  console.log(read(), "|", later.seen());
});
