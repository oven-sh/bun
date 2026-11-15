import { test, vi } from "bun:test";
vi.mock("./tax.json", () => ({ ...require("./tax.json"), rate: "aMock" }));
test("a", async () => console.log("a", (await import("./sale.mjs")).sold()));
