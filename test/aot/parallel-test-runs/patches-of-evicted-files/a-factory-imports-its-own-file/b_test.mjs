import { test, vi, jest, mock } from "bun:test";
test("b", async () => {
vi.mock("./top.mjs", async () => ({ ...(await vi.importActual("./top.mjs")), top: () => "mocked top" }));
vi.mock("./low.mjs", () => ({ low: () => "mocked low", lowName: "ml" }));
const { user } = await import("./user.mjs"); console.log("SAID b", user()); const t = await import("./top.mjs"); console.log("SAID b2", t.top(), t.topName, Object.keys(t).sort().join()); });
