import { test, vi, mock, jest } from "bun:test";
import { get } from "made-up-pkg";
vi.mock("made-up-pkg", async original => ({ ...(await original()), get: () => 0 }));
test("t", () => { const all = import.meta.require("made-up-pkg"); all.bump(); console.log("SAID", all.count, all.get(), get()); });
