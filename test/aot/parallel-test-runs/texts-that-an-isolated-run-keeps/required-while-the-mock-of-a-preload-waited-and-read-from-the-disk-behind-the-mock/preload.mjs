import { vi } from "bun:test";
vi.mock("./shared.cjs", async () => {
  await 0;
  return { label: "mock" };
});
