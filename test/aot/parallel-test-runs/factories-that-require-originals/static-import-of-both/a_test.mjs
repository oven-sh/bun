import { jest, test } from "bun:test";
import { sold } from "./sale.mjs";
jest.mock("./tax.mjs", () => ({ ...require("./tax.mjs"), rate: "taxMock" }));
jest.mock("./fx.mjs", () => ({ ...jest.requireActual("./fx.mjs"), rate: "fxMock" }));
test("a", () => console.log("a", sold()));
