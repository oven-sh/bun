import { test, vi } from "vitest";
import { adapter } from "./adapter.mjs";
vi.mock("./credentials.mjs", async original => ({ ...(await original()) }));
test("third file", () => console.log("SAID c", adapter()));
