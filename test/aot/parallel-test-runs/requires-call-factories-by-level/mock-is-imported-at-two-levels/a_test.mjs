import { jest, test } from "bun:test";
jest.mock("./tax.mjs", () => (console.log("tax factory"), { rate: "taxMock" }));
jest.mock("./fx.mjs", () => (console.log("fx factory"), { rate: "fxMock" }));
test("a", () => console.log("a", require("./shop.mjs").shown()));
