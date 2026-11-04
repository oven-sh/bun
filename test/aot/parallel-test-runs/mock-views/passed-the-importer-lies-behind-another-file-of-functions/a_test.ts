// 
import { vi, test } from "bun:test";
import { through } from "./between";
vi.doMock("./dep", () => ({ v: () => "mocked" }));
test("views", async () => {
  const later = await import("./later");
  console.log(through(), "|", later.seen());
});
