import { test, vi, mock, jest } from "bun:test";
import * as all from "made-up-pkg";
vi.mock("made-up-pkg", async original => ({ ...(await original()), get: () => 0 }));
test("t", () => { const spy = vi.spyOn(all, "get").mockReturnValue(9); console.log("SAID", all.get(), import.meta.require("made-up-pkg").get()); spy.mockRestore(); console.log("SAID", all.get()); });
