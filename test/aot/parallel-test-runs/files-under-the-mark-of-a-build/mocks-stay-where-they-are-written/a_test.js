// @bun
import { test, vi } from "bun:test";
import { seenAtLoad } from "./reads-a.js";
vi.mock("./config-a.js", () => ({ mode: "mocked" }));
test("vi.mock under the mark", () => {
  console.log(seenAtLoad);
});
