import { jest, mock, test, vi } from "bun:test";
vi.mock("./tax.mjs", async () => {
  console.log("factory");
  await 0;
  return { rate: "mock" };
});
test("a", () => console.log("a", require("./tax.mjs").rate));
