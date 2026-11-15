import { test } from "vitest";
import { vi } from "./tools.mjs";
import * as all from "./part.mjs";
test("t", () => { vi.spyOn(all, "get").mockReturnValue(7); console.log("SAID", all.get()); });
