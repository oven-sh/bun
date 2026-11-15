import { test, vi } from "bun:test";
import { user } from "./user.mjs";
vi.mock("./low.mjs", () => ({ low: () => "c low", lowName: "cl" }));
test("c", async () => { console.log("SAID c", user(), (await import("./top.mjs")).top()); });
