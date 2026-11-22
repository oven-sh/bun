import { vi } from "bun:test";

vi.mock("./api.ts", async (importOriginal: any) => {
  console.log("the factory runs");
  return { ...(await importOriginal()), get: () => "set-up" };
});
