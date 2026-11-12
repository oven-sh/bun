import { test, vi } from "bun:test";
import { sold } from "./sale.mjs";
vi.mock("./tax.json", () => ({ rate: "dMock", default: { rate: "dMock" }, fee: () => 1 }));
test("d", async () => console.log("d", sold(), Object.keys(await import("./tax.json")).sort().join()));
