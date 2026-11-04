import { jest, test } from "bun:test";
const mockF = () => "mocked";
jest.mock("./m", () => ({ f: mockF }));
test("b", async () => {
  const { f } = await import("./m");
  console.log("b", f());
});
