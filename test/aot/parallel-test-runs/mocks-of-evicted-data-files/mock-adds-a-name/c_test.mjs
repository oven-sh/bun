import { test, vi } from "bun:test";
import { sold } from "./sale.mjs";
vi.mock("./tax.json", () => ({ rate: "cMock", fee: () => "fee", default: { rate: "cMock" } }));
test("c", () => console.log("c", sold()));
