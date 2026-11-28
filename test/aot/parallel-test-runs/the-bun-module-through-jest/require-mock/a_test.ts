import { jest, test } from "bun:test";

test("without a mock", () => {
  const { escapeHTML } = jest.requireMock("bun");
  console.log(escapeHTML("<i>"));
});
