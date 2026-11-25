import { test, vi } from "bun:test";
vi.mock("./part", { spy: true });
import "./user";
test("loads", async () => {
  const mocked = await import("./part");
  const user = await import("./user");
  const actual = await vi.importActual("./part");
  console.log("SAID spy", String(user.sees()), mocked.name, String(mocked.fn()), vi.isMockFunction(mocked.fn), "&", actual.name, actual.fn(), String(actual.peek()), "|", String(globalThis.order));
});
