import { jest, test } from "bun:test";
import { sold } from "./sale.mjs";
jest.doMock("./tax.json", () => ({ ...jest.requireActual("./tax.json"), rate: "bMock" }));
test("b", () => console.log("b", sold()));
