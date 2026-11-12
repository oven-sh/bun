import { expect, test, vi } from "bun:test";
vi.mock("./m0.js");
import "./m1.js";
test("the original first, then the module that imports the mock", () => expect(globalThis.order).toEqual(["m0", "m1"]));
