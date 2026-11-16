import { jest, test } from "bun:test";
jest.mock("./tax.json", () => ({ rate: "cMock", default: { rate: "cMock" } }));
test("c", async () => console.log("c", (await import("./sale.mjs")).sold()));
