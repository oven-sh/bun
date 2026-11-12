const { test, jest } = require("bun:test");
jest.mock("./m", () => ({ v: "mocked" }));
const { v } = require("./p");
test("a", () => { console.log("a", String(v), String(require("./p").v)); });
