import { jest, mock, test, vi } from "bun:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const get = load => { try { return load(); } catch (error) { return String(error.message).slice(0, 22); } };
test("a", async () => {
  await import("./user.mjs");
});
