import { jest, test } from "bun:test";
import { sold } from "./sale.mjs";
jest.mock("./tax.json", () => ({ ...require("./tax.json"), rate: "aMock" }));
test("a", () => console.log("a", sold()));
