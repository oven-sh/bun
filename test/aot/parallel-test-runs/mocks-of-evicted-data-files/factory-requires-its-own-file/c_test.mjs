import { test, vi } from "bun:test";
import { sold } from "./sale.mjs";
vi.mock("./tax.json", () => ({ ...require("./tax.json"), rate: "cMock" }));
test("c", async () => console.log("c", sold(), (await import("./tax.json")).rate));
