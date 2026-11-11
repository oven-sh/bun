import { test, vi } from "bun:test";
import { keys, a } from "./helper.js";
vi.mock("./part.cjs", () => ({ a: "mocked", added: "mocked", default: "mocked" }));
test("t", () => {
  console.log("SAID the helper", keys(), a());
  console.log("SAID what the preload holds", Object.keys(heldByThePreload).sort().join(), heldByThePreload.a);
});
