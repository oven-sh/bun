import { it } from "bun:test";

it("read", async () => {
  // This doesn't run on Linux but it shouldn't throw at least
  const text = await Bun.Clipboard.readText();
  expect(text).toBe("hello");
});
