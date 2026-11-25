import { expect, test, vi } from "bun:test";
import { Derived } from "./derived.js";
vi.mock("./base.js", async importOriginal => ({ ...(await importOriginal()), Base: class { who() { return "mocked"; } } }));
test("the exports of the mock are ready", () => expect(new Derived().who()).toBe("mocked"));
