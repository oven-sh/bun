import { test, vi } from "vitest";
import * as all from "./part.mjs";
import { seen } from "./user.mjs";
test("t", () => { vi.spyOn(all, "get").mockReturnValue(7); console.log("SAID", seen()); vi.restoreAllMocks(); console.log("SAID", seen()); });
