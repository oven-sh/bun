// @bun
import { vi } from "bun:test";
let ended;
try {
  vi.doMock(import("./config-under-the-mark.js"), () => ({ mode: "mocked" }));
  ended = "returns";
} catch (error) {
  ended = error.name + ": " + error.message;
}
export const found = ended + ", " + (await import("./config-under-the-mark.js")).mode;
