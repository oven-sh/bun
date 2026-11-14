import { test, vi } from "vitest";
import { adapter } from "./adapter.mjs";
vi.mock("./credentials.mjs", () => ({ parse: () => 30 }));
test("third file", () => console.log("SAID c", adapter()));
