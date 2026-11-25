import { test, vi } from "vitest";
import * as all from "./part.mjs";
test("t", () => { vi.spyOn(all, "get").mockReturnValue(7); console.log("SAID", all.get()); });
