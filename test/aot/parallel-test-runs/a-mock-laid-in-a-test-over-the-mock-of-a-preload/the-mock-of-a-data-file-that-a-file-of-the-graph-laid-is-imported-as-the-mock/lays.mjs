import { vi } from "bun:test";
vi.doMock("./lib.json", async () => {
  await 0;
  return { a: "of the graph" };
});
