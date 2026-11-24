import { test, vi } from "bun:test";
import * as svc from "../src/svc.mjs";

vi.doMock("../src/api.mjs", async original => ({ ...(await original()), get: () => "test" }));

test("a", () => {
  console.log("SAID", svc.load(), require("../src/api.mjs").get(), svc.load(), globalThis.runs);
});
