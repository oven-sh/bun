// @bun
import { test, jest } from "bun:test";
import { seenAtLoad } from "./reads-b.js";
jest.mock("./config-b.js", () => ({ mode: "mocked" }));
test("jest.mock under the mark", () => {
  console.log(seenAtLoad);
});
