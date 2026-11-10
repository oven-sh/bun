import { expect, test, vi } from "bun:test";
import { seen } from "./d.js";
import * as c from "./c.js";
vi.mock("./c.js", async importOriginal => ({ ...(await importOriginal()), c: "mocked-c", seenInTheFactory: (await import("./d.js")).seen() }));
test("the factory's copy sees the original", () => expect([seen(), c.c, c.seenByD(), c.seenInTheFactory]).toEqual(["mocked-c", "mocked-c", "mocked-c", "real-c"]));
