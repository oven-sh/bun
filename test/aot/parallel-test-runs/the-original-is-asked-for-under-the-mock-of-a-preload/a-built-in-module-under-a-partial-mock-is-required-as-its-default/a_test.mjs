import { jest, test, vi } from "bun:test";
import * as fs from "node:fs";
vi.mock("node:fs", async original => ({ ...(await original()), readFileSync: () => "mocked" }));
test("the original of a built-in module is required as what its import has as the default", async () => {
  const actual = await vi.importActual("node:fs");
  console.log("SAID", fs.readFileSync("x"), jest.requireActual("fs") === actual.default, jest.requireActual("node:fs") === actual.default);
});
