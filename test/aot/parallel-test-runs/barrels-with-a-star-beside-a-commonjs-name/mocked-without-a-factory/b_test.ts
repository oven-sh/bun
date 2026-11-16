import { test, vi } from "bun:test";
import * as barrel from "./barrel.ts";
import * as other from "./other.ts";

vi.mock("./barrel.ts");

test("sees the mock", () => {
  console.log("b", barrel.send(), other.send(), barrel.limit);
});
