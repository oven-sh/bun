import { jest, vi } from "bun:test";

vi.mock("./api.ts", () => {
  console.log("the factory runs");
  return { ...jest.requireActual<any>("./api.ts"), get: () => "set-up" };
});
