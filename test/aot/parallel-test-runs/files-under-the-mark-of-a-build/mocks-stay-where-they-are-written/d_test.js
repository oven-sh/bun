import { test, vi } from "bun:test";
import { seenAtLoad } from "./reads-d.js";
vi.mock("./config-d.js", () => ({ mode: "mocked" }));
test("vi.mock without the mark", () => {
  console.log(seenAtLoad);
});
