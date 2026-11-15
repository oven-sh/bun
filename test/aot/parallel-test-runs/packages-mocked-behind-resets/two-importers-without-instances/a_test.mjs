import { jest, mock, test, vi } from "bun:test";
import { channel } from "./channel.mjs";
test("a", () => {
  console.log("a", channel());
  vi.resetModules();
});
