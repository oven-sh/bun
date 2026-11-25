import { vi, test } from "bun:test";
const mockF = () => "mocked";
vi.mock("./m", () => ({ f: mockF }));
test("b", async () => {
  const { f } = await import("./m");
  console.log("b", f());
});
