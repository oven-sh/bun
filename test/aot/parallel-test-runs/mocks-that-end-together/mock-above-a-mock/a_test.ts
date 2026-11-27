import { test, vi } from "bun:test";
import { load } from "./x.cjs";
vi.mock("./n.ts", () => ({ size: () => "mn" }));
test("a", () => {
  console.log("one a " + load());
  vi.doMock("./x.cjs", () => ({ load: () => "second" }));
});
